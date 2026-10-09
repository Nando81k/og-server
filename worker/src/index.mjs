/**
 * The OG server bot, as a Cloudflare Worker.
 *
 * Discord calls this endpoint when someone runs /lfg, rather than the bot
 * holding a connection open — which is what lets it run on a free plan with no
 * always-on machine.
 *
 * Two entry points:
 *   fetch()     - slash commands, arriving as signed HTTPS requests
 *   scheduled() - the New Member -> Member promotion pass, plus the weekly
 *                 pick'em job (score last week, post the leaderboard, sync
 *                 the next week's schedule)
 */

import { isFromDiscord } from './verify.mjs';
import { createApi } from './rest.mjs';
import {
  GAME_ROLES,
  voiceRoomFor,
  isDueForPromotion,
  clampSlots,
  isChannelNamed,
} from '../../shared/lib.mjs';
import { verifyPickToken, signPickToken } from './token.mjs';
import { renderForm, renderMessage } from './form.mjs';
import { validateSubmission, lockTime, hasManageMessages, validateAward } from './validate.mjs';
import {
  getGames, getPicks, savePicks, openWeek,
  upsertGames as dbUpsert, setResults as dbSetResults, allPicks as dbAllPicks,
  allPicks as allPicks_,
  upsertTeams as dbUpsertTeams, getTeams,
  alreadyDone as dbAlreadyDone, markDone as dbMarkDone,
  awardPoints, seasonAwards as dbSeasonAwards,
  activeTournament, createTournament, tournamentEntrants, joinTournament,
  leaveTournament, startTournament, recordResult, closeTournament,
} from './db.mjs';
import {
  drawSeeds, replay, canReport, reportChoices,
  signupMessage, bracketMessage, resultsMessage, awardsFor,
  openMatches as bracketOpenMatches, isComplete as bracketIsComplete,
  MIN_ENTRANTS, MAX_ENTRANTS,
} from './tournament.mjs';
import { BRACKET_MOD_ONLY, TRADE_MOD_ONLY, FANTASY_MOD_ONLY } from '../../shared/commands.mjs';
import { fetchWeek as espnFetchWeek, fetchCurrentWeek as espnFetchCurrentWeek } from './espn.mjs';
import { buildStandings, mergeAwards, scoreSeason } from './scoring.mjs';
import { weekOneAnnouncement, lockedMessage, standingsMessage } from './announce.mjs';
import {
  getLink, linkTeam, linkForTeam, createTrade, setTradeMessage, getTrade,
  liveTrades as dbLiveTrades, dueTrades, resolveTrade, castVote, tradeVotes,
} from './db.mjs';
import {
  LIVE, DEFAULT_VOTE_HOURS, MAX_NOTE,
  tallyVotes, decide, parseCustomId, voteComponents, voteLabel, clean,
  proposalMessage, closedMessage, resultAnnouncement, validateProposal, findCompletedTrades,
  parseExploreId, exploreMessage, exploreComponents,
} from './trade.mjs';
import { playerEmbed, compareEmbed, chartData } from './player.mjs';
import { areaChartUrl } from './chart.mjs';
import {
  fantasyConfig,
  fetchLeague as fantasyFetchLeague,
  fetchActivity as fantasyFetchActivity,
  fetchRosters as fantasyFetchRosters,
  fetchPlayerCards as fantasyFetchPlayerCards,
  fetchBio as fantasyFetchBio,
  searchPlayers as fantasySearchPlayers,
  categoriesFrom,
  diagnose as fantasyDiagnose,
  diagnosticMessage,
  parseStandings,
  parseMatchups,
  standingsMessage as fantasyStandingsMessage,
  scoresMessage as fantasyScoresMessage,
  activityMessage as fantasyActivityMessage,
  activityLine,
} from './fantasy.mjs';

const PING = 1;
const APPLICATION_COMMAND = 2;
const MESSAGE_COMPONENT = 3;
const UPDATE_MESSAGE = 7;
const AUTOCOMPLETE = 4;
const PONG = 1;
const REPLY = 4;
const AUTOCOMPLETE_RESULT = 8;

/** Only the person who ran the command sees the reply. */
const PRIVATE = 64;

/** Discord channel type for a guild voice channel. */
const GUILD_VOICE = 2;

/**
 * Upper bound when scanning a finished season. The NFL plays 18 weeks; this
 * only caps the loop for a season with nothing left unscored, so openWeek
 * returns null and there is no natural stopping point to read from the data.
 */
const MAX_WEEKS = 22;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function optionsOf(interaction) {
  const out = {};
  for (const o of interaction?.data?.options ?? []) out[o.name] = o.value;
  return out;
}

/**
 * The chosen subcommand of a grouped command like /bracket.
 *
 * Discord nests these: data.options is a one-element list holding the
 * subcommand, whose own options are the arguments the user actually filled in.
 */
function subcommandOf(interaction) {
  const sub = (interaction?.data?.options ?? [])[0] ?? {};
  const args = {};
  for (const o of sub.options ?? []) args[o.name] = o.value;
  return { name: sub.name ?? '', args, options: sub.options ?? [] };
}

const say = (content, extra = {}) => ({ content, allowed_mentions: { parse: [] }, ...extra });
const onlyYou = (content) => ({ content, flags: PRIVATE });

/** Longest tournament name the points ledger can carry a reason for. */
export const MAX_TOURNAMENT_NAME = 80;

/** What to call someone: their server nickname first, then their real name. */
export function displayNameOf(member) {
  return member?.nick
    || member?.user?.global_name
    || member?.user?.username
    || 'someone';
}

/**
 * Every /bracket subcommand.
 *
 * One tournament runs at a time, so nothing here takes an id — each subcommand
 * resolves the open one itself. The bracket is never stored: it is replayed
 * from the draw and the list of results on every call, which is what makes the
 * undo exact and means two commands can never disagree about the state.
 */
export async function handleBracket(interaction, env) {
  const season = Number(env.SEASON);
  const userId = interaction.member?.user?.id ?? interaction.user?.id;
  const isMod = hasManageMessages(interaction.member);
  const { name: sub, args } = subcommandOf(interaction);

  // Discord can only hide a whole command, never one subcommand, so these four
  // are visible to everyone and refused here. See shared/commands.mjs.
  if (BRACKET_MOD_ONLY.includes(sub) && !isMod) {
    return onlyYou(`Only mods can do that. You can \`/bracket join\`, \`view\` and \`report\`.`);
  }

  const active = await activeTournament(env.DB, season);

  if (sub === 'create') {
    if (active) {
      return onlyYou(
        `**${active.name}** is still going. Finish it, or \`/bracket cancel\` it first.`
      );
    }
    const name = String(args.name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TOURNAMENT_NAME);
    if (!name) return onlyYou('Give it a name.');
    await createTournament(env.DB, {
      id: crypto.randomUUID(),
      season,
      name,
      channelId: interaction.channel_id,
      createdBy: userId,
    });
    return say(signupMessage({ name, entrants: [] }));
  }

  if (!active) {
    return onlyYou('No tournament is running. A mod opens one with `/bracket create`.');
  }

  if (sub === 'join' || sub === 'leave') {
    if (active.status !== 'signup') {
      return onlyYou(`**${active.name}** has already been drawn — the bracket is set.`);
    }
    if (sub === 'join') {
      const entrants = await tournamentEntrants(env.DB, active.id);
      if (entrants.length >= MAX_ENTRANTS && !entrants.some((e) => e.userId === userId)) {
        return onlyYou(`**${active.name}** is full at ${MAX_ENTRANTS}.`);
      }
      await joinTournament(env.DB, active.id, {
        userId,
        displayName: displayNameOf(interaction.member),
      });
    } else {
      const removed = await leaveTournament(env.DB, active.id, userId);
      if (!removed) return onlyYou('You were not in it.');
    }
    return say(signupMessage({
      name: active.name,
      entrants: await tournamentEntrants(env.DB, active.id),
    }));
  }

  if (sub === 'start') {
    if (active.status !== 'signup') return onlyYou(`**${active.name}** is already running.`);
    const entrants = await tournamentEntrants(env.DB, active.id);
    if (entrants.length < MIN_ENTRANTS) {
      return onlyYou(
        `Only ${entrants.length} signed up. A bracket needs at least ${MIN_ENTRANTS}.`
      );
    }
    const seeds = drawSeeds(entrants.map((e) => e.userId));
    // Refused means somebody else drew it in the meantime. Drawing twice would
    // reshuffle a bracket people are already playing.
    if (!await startTournament(env.DB, active.id, seeds)) {
      return onlyYou('Someone just started it — `/bracket view` for the draw.');
    }
    return say(bracketMessage({ name: active.name, bracket: replay(seeds, []) }));
  }

  if (sub === 'view') {
    if (active.status === 'signup') {
      return say(signupMessage({
        name: active.name,
        entrants: await tournamentEntrants(env.DB, active.id),
      }));
    }
    return say(bracketMessage({
      name: active.name,
      bracket: replay(active.seeds, active.results),
    }));
  }

  if (sub === 'cancel') {
    await closeTournament(env.DB, active.id, 'cancelled');
    return say(`**${active.name}** is off. No points were awarded.`);
  }

  if (active.status !== 'running') {
    return onlyYou(`**${active.name}** has not been drawn yet.`);
  }

  const bracket = replay(active.seeds, active.results);

  if (sub === 'undo') {
    if (active.results.length === 0) return onlyYou('Nothing has been reported yet.');
    const dropped = active.results[active.results.length - 1];
    const kept = active.results.slice(0, -1);
    if (!await recordResult(env.DB, active.id, active.resultsRaw, kept)) {
      return onlyYou('Something else changed the bracket just now. Try again.');
    }
    return say(
      `Took back \`${dropped.match}\`. It is playable again.\n\n` +
      bracketMessage({ name: active.name, bracket: replay(active.seeds, kept) })
    );
  }

  if (sub === 'report') {
    const match = bracketOpenMatches(bracket).find((m) => m.id === args.match);
    if (!match) {
      return onlyYou(
        `\`${args.match}\` is not a match waiting on a result. \`/bracket view\` for what is.`
      );
    }
    if (!canReport(match, userId, { isMod })) {
      return onlyYou('Only the two players in that set, or a mod, can report it.');
    }
    const winner = args.winner;
    if (winner !== match.a && winner !== match.b) {
      return onlyYou(`<@${winner}> is not in \`${match.id}\`.`);
    }

    const results = [...active.results, { match: match.id, winner }];
    // Refused means somebody reported another set between this command reading
    // the bracket and writing to it. Overwriting would lose their result.
    if (!await recordResult(env.DB, active.id, active.resultsRaw, results)) {
      return onlyYou('Someone reported at the same moment. Run it again.');
    }

    const next = replay(active.seeds, results);
    if (!bracketIsComplete(next)) {
      return say(bracketMessage({ name: active.name, bracket: next }));
    }

    await payOutTournament(env.DB, season, active, next, userId);
    return say(
      resultsMessage({ name: active.name, bracket: next }) +
      '\nWrong result? A mod can correct it with `/award`.'
    );
  }

  return onlyYou('Not something I handle.');
}

/**
 * Write a finished tournament's placings into the season points ledger.
 *
 * Guarded by a done-marker for the same reason the weekly pick'em job is: the
 * ledger is append-only and has no idea that two rows for the same placing are
 * a mistake, so paying out twice would double everyone's points with nothing
 * to distinguish the duplicate from a real second award.
 */
export async function payOutTournament(db, season, tournament, bracket, awardedBy) {
  const marker = `bracket:${tournament.id}:awarded`;
  if (await dbAlreadyDone(db, marker)) return false;
  for (const a of awardsFor(bracket, tournament.name)) {
    await awardPoints(db, {
      season,
      userId: a.userId,
      amount: a.amount,
      reason: a.reason,
      awardedBy,
    });
  }
  await dbMarkDone(db, marker);
  await closeTournament(db, tournament.id, 'done');
  return true;
}

/** The playable matches, as the picker list on /bracket report's match option. */
export async function handleBracketAutocomplete(interaction, env) {
  const active = await activeTournament(env.DB, Number(env.SEASON));
  if (!active || active.status !== 'running') return [];
  const { options } = subcommandOf(interaction);
  const typed = options.find((o) => o.focused)?.value ?? '';
  const entrants = await tournamentEntrants(env.DB, active.id);
  const names = Object.fromEntries(entrants.map((e) => [e.userId, e.displayName]));
  return reportChoices(replay(active.seeds, active.results), names, typed);
}

export async function handleLfg(interaction, env, api) {
  const { game, slots } = optionsOf(interaction);
  const roleName = GAME_ROLES[game];
  if (!roleName) return { content: 'Unknown game.', flags: 64 };

  const count = clampSlots(slots ?? 5);
  const roomName = voiceRoomFor(game);

  const [roles, channels] = await Promise.all([api.roles(env.GUILD_ID), api.channels(env.GUILD_ID)]);
  const role = roles.find((r) => r.name === roleName);
  // Match on type as well as name: a text channel sharing the room's name would
  // otherwise be linked instead, and `<#id>` gives no hint that it went wrong.
  // The name comparison ignores emoji and separators so decorating the channel
  // list does not break the jump link.
  const room = channels.find((c) => c.type === GUILD_VOICE && isChannelNamed(c, roomName));
  const who = interaction.member?.user?.id ?? interaction.user?.id;

  const ping = role ? `<@&${role.id}>` : roleName;

  // A missing room used to fall back to the bare room name, which reads as a
  // dead link and tells nobody why. Say what is wrong instead, and log it.
  let where;
  if (room) {
    where = `Jump in: <#${room.id}>`;
  } else {
    console.warn(`/lfg: no voice channel named ${JSON.stringify(roomName)} in guild ${env.GUILD_ID}`);
    where = `No **${roomName}** channel exists yet — someone with Manage Channels needs to create it.`;
  }

  return {
    content: `${ping} — <@${who}> is running **${roleName}**, ${count} slots.\n${where}`,
    allowed_mentions: { parse: [], roles: role ? [role.id] : [], users: who ? [who] : [] },
  };
}

export async function runPromotions(env, api, now = Date.now()) {
  const afterDays = Number(env.MEMBER_AFTER_DAYS ?? 7);
  const roles = await api.roles(env.GUILD_ID);
  const newMember = roles.find((r) => r.name === 'New Member');
  const member = roles.find((r) => r.name === 'Member');
  if (!newMember || !member) {
    console.warn('New Member or Member role missing — skipping promotions.');
    return { promoted: 0, skipped: 0 };
  }

  const members = await api.members(env.GUILD_ID);
  let promoted = 0;
  let skipped = 0;

  for (const m of members) {
    if (!m.roles?.includes(newMember.id)) continue;
    const joinedAt = m.joined_at ? Date.parse(m.joined_at) : null;
    if (!isDueForPromotion({ joinedAt, now, afterDays })) {
      skipped += 1;
      continue;
    }
    try {
      await api.addRole(env.GUILD_ID, m.user.id, member.id);
      await api.removeRole(env.GUILD_ID, m.user.id, newMember.id);
      promoted += 1;
    } catch (err) {
      console.warn(`Could not promote ${m.user?.id}: ${err.message}`);
    }
  }
  return { promoted, skipped };
}

export async function runWeekly(env, api, deps = {}) {
  const season = Number(env.SEASON);
  const {
    now = Date.now(),
    fetchWeek = espnFetchWeek,
    fetchCurrentWeek = espnFetchCurrentWeek,
    setResults = dbSetResults,
    upsertGames = dbUpsert,
    upsertTeams = dbUpsertTeams,
    allPicks = dbAllPicks,
    alreadyDone = dbAlreadyDone,
    markDone = dbMarkDone,
    seasonAwards = dbSeasonAwards,
  } = deps;
  // getGames and openWeek are also imported plainly for use in fetch() below,
  // so their overridable-for-testing default can't be spelled as a
  // same-named destructuring default (`getGames = getGames` throws — the
  // local binding shadows the module import before it's initialized).
  const getGames_ = deps.getGames ?? getGames;
  const openWeek_ = deps.openWeek ?? openWeek;

  const week = await openWeek_(env.DB, season);
  if (!week) {
    // openWeek is null with an empty games table on day one, before anything
    // has ever been seeded — and, defensively, if a prior run scored the
    // last week of a season but its sync step then failed, leaving no
    // following week synced. Either way there's no week to score yet; seed
    // whatever week ESPN currently reports so the season can start (or
    // resume) instead of sitting silent forever waiting for a week that
    // nothing will ever open. upsertGames only ever updates kickoff on
    // conflict, so re-seeding a week that already has rows is harmless.
    try {
      const current = await fetchCurrentWeek();
      await upsertTeams(env.DB, current.teams ?? []);
      await upsertGames(env.DB, season, current.week, current.games);
      return { scored: null, synced: current.week };
    } catch (err) {
      console.warn(`Could not seed the season: ${err.message}`);
      return { scored: null, synced: null };
    }
  }

  let fresh;
  try {
    fresh = await fetchWeek({ season, week });
  } catch (err) {
    console.warn(`ESPN unavailable, doing nothing this run: ${err.message}`);
    return { scored: null, synced: null };
  }

  // An empty slate means "ESPN has nothing for this week yet" — ask again
  // next run. It must never be read as "every game is done": [].every() is
  // vacuously true, and without this guard the completeness check below
  // would treat a blank response as a finished week and void every stored
  // game in it.
  if (fresh.games.length === 0) return { scored: null, synced: null };

  // Only score a week where every game has finished. A week is all or nothing.
  if (!fresh.games.every((g) => g.completed)) return { scored: null, synced: null };

  // A game postponed out of the week disappears from the feed. The spec voids
  // it rather than renumbering everyone's confidence after the fact.
  const stored = await getGames_(env.DB, season, week);
  const live = new Set(fresh.games.map((g) => g.id));
  const dropped = stored.filter((g) => !live.has(g.id)).map((g) => ({ ...g, winner: null, voided: true }));
  // This week's finished games, not yet written down. Writing them is what
  // advances openWeek — the one irreversible step here — so it happens last,
  // after everything that can fail has succeeded. Scoring reads them from
  // memory in the meantime; the shape ESPN returns already carries the id,
  // winner, completed and voided fields scoreWeek looks at.
  const settled = [...fresh.games, ...dropped];

  // Score every week of the season, not just this one: the posted table is
  // the season standings, and recomputing from stored rows is what makes a
  // second run of this job produce identical numbers. This week's results come
  // from memory because they are not written down until the posts succeed.
  const weeks = [];
  for (let w = 1; w <= week; w += 1) {
    weeks.push({
      week: w,
      games: w === week ? settled : await getGames_(env.DB, season, w),
      picks: await allPicks(env.DB, season, w),
    });
  }
  const { rows, weeksPlayed: seasonWeeks } = scoreSeason(weeks);

  // Hand-awarded points join here rather than in buildStandings, so a
  // tournament win never counts as a week of pick'em entered.
  const table = mergeAwards(buildStandings(rows), await seasonAwards(env.DB, season));
  // "Entered every week" means every week the season has actually had games
  // for, not "the current week number" — a season bootstrapped mid-way
  // (e.g. starting at week 3) never reaches r.weeks === week otherwise.
  const everyWeek = table.filter((r) => r.weeks === seasonWeeks).map((r) => `<@${r.userId}>`);
  // buildStandings collapses per-week rows into season totals, so the week
  // just scored is looked up from the `rows` this run already built rather
  // than changing buildStandings's shape.
  const weekPoints = new Map(rows.filter((r) => r.week === week).map((r) => [r.userId, r.points]));
  const lines = table
    .map((r, i) => `${i + 1}. <@${r.userId}> — ${r.points} (+${weekPoints.get(r.userId) ?? 0} this week)`)
    .join('\n');

  // Nothing below is caught. If Discord is unreachable the run must fail here,
  // before the results write, so openWeek stays on this week and tomorrow's
  // run does all of it again. A post that already landed is skipped by its
  // marker, so retrying costs nobody a duplicate.
  const postedKey = `posted:${season}:${week}`;
  if (!(await alreadyDone(env.DB, postedKey))) {
    await api.postMessage(
      env.LEADERBOARD_CHANNEL_ID,
      `**Week ${week} is in.**\n${lines}` +
        (everyWeek.length ? `\n\nEntered every week: ${everyWeek.join(', ')}` : '')
    );
    await markDone(env.DB, postedKey);
  }

  // The first scored week of the season is the moment the pick'em stops being
  // an idea and starts being a table with names in it — the only time a ping
  // is worth spending.
  //
  // Tracked by its own marker rather than by `week === 1`, which is not a fact
  // that survives a retry: the results write below is what moves openWeek off
  // week 1, so under the old order a post that failed after that write could
  // never be attempted again. A permanently bad PICKEM_CHANNEL_ID now stalls
  // the season here instead, which is the failure worth having — a season that
  // visibly stops is one somebody fixes, and a ping that vanishes silently is
  // not.
  const announcedKey = `announced:${season}`;
  if (week === 1 && env.PICKEM_CHANNEL_ID && !(await alreadyDone(env.DB, announcedKey))) {
    await api.postMessage(
      env.PICKEM_CHANNEL_ID,
      weekOneAnnouncement({ leaderboardChannelId: env.LEADERBOARD_CHANNEL_ID }),
      { parse: ['everyone'] }
    );
    await markDone(env.DB, announcedKey);
  }

  // Everything that can fail has succeeded. Advance the season.
  await setResults(env.DB, season, week, settled);

  const next = week + 1;
  try {
    const upcoming = await fetchWeek({ season, week: next });
    await upsertTeams(env.DB, upcoming.teams ?? []);
    await upsertGames(env.DB, season, next, upcoming.games);
    return { scored: week, synced: next };
  } catch {
    return { scored: week, synced: null };
  }
}

/**
 * The daily trigger. Two independent jobs share it, and neither may take the
 * other down: promotions failing is a nuisance, the pick'em failing on the
 * week it launches is the season. They used to run in sequence unguarded, so
 * a 401 on the member list — the one call in runPromotions that isn't caught
 * — meant the leaderboard and the one-shot @everyone ping never ran at all,
 * every day, for a reason that had nothing to do with them.
 *
 * Failures are still thrown, just last. Cloudflare marking the invocation
 * failed is the only signal anyone sees from outside, and swallowing it would
 * make a bot that has been broken for a week look identical to one that has
 * nothing to do.
 */
export async function runCron(env, api, deps = {}) {
  const { promotions = runPromotions, weekly = runWeekly } = deps;
  const failures = [];

  try {
    const promo = await promotions(env, api);
    console.log(`Promotion pass: ${promo.promoted} promoted, ${promo.skipped} not due yet.`);
  } catch (err) {
    console.error(`Promotion pass failed: ${err.message}`);
    failures.push(`promotions: ${err.message}`);
  }

  try {
    const week = await weekly(env, api);
    console.log(`Pick'em: scored ${week.scored ?? 'nothing'}, synced ${week.synced ?? 'nothing'}.`);
  } catch (err) {
    console.error(`Pick'em run failed: ${err.message}`);
    failures.push(`pick'em: ${err.message}`);
  }

  if (failures.length) throw new Error(failures.join('; '));
}

/** Discord rejects a message over this many characters outright. */
const MAX_MESSAGE = 2000;

/** An ESPN player id to inspect when nobody is on a roster yet. */
const FALLBACK_DEBUG_PLAYER = 3112335;

/** The cron that drives the fantasy feed. Kept in step with wrangler.toml. */
export const FANTASY_CRON = '*/10 * * * *';

/**
 * Most moves one feed run will post. A league that was quiet for a day can
 * come back with a long backlog; the rest are left unmarked and go out on the
 * next run rather than one run spending its whole subrequest allowance.
 */
const MAX_FEED_POSTS = 10;

/**
 * /fantasy standings | scores | recent | link.
 *
 * Read-only and public. ESPN's answer is trimmed to Discord's limit rather
 * than refused, and a failure is reported privately: "ESPN refused the
 * request" is a thing for whoever runs the bot to see, not the channel.
 */
export async function handleFantasy(interaction, env, deps = {}) {
  const {
    fetchLeague = fantasyFetchLeague,
    fetchActivity = fantasyFetchActivity,
    fetchRosters = fantasyFetchRosters,
    diagnose = fantasyDiagnose,
  } = deps;
  const cfg = fantasyConfig(env);
  if (!cfg) return onlyYou('The fantasy league has not been connected yet.');
  const { name: sub, args } = subcommandOf(interaction);

  // Discord can only hide a whole command, never one subcommand, so this is
  // visible to everyone and refused here. See shared/commands.mjs.
  if (FANTASY_MOD_ONLY.includes(sub) && !hasManageMessages(interaction.member)) {
    return onlyYou('Only mods can do that.');
  }

  try {
    let content;
    if (sub === 'standings') {
      content = fantasyStandingsMessage(parseStandings(await fetchLeague(cfg)));
    } else if (sub === 'scores') {
      content = fantasyScoresMessage(parseMatchups(await fetchLeague(cfg)));
    } else if (sub === 'recent') {
      content = fantasyActivityMessage((await fetchActivity(cfg, { size: 10 })).slice(0, 10));
    } else if (sub === 'debug') {
      // Private to the mod, and made of field names and counts only. It exists
      // so the parts of this bot built on guesses about ESPN can be checked
      // against the real league in one command.
      const rosters = await fetchRosters(cfg);
      const first = rosters.teams.flatMap((t) => t.players)[0];
      // Before the draft nobody is on a roster, so there is no one to default
      // to. A player card works for any ESPN player id, rostered or not.
      const id = args.player !== undefined ? Number(args.player) : (first?.id ?? FALLBACK_DEBUG_PLAYER);
      if (!Number.isInteger(id)) return onlyYou('Pick a player from the list, or type an ESPN player id.');
      const note = args.player === undefined && !first
        ? 'Nobody is on a roster yet, so this used a default player.\n'
        : '';
      return onlyYou((note + diagnosticMessage(await diagnose(cfg, id))).slice(0, MAX_MESSAGE));
    } else if (sub === 'link') {
      // A claim, not a proof: nothing ties a Discord account to an ESPN one.
      // It is enough for a friend group, and a mod can reassign a wrong one.
      const caller = interaction.member?.user?.id ?? interaction.user?.id;
      const target = args.user ?? caller;
      const isMod = hasManageMessages(interaction.member);
      if (target !== caller && !isMod) return onlyYou('Only mods can link someone else’s team.');
      const team = (await fetchRosters(cfg)).teams.find((t) => String(t.id) === String(args.team));
      if (!team) return onlyYou('That team is not in the league. Pick one from the list.');
      const res = await linkTeam(env.DB, {
        season: cfg.season, userId: target, teamId: team.id, teamName: team.name, force: isMod,
      });
      if (!res.ok) {
        return onlyYou(`**${clean(team.name)}** is already linked to <@${res.takenBy}>. A mod can reassign it.`);
      }
      content = `<@${target}> is now **${clean(team.name)}**.`;
    } else {
      return onlyYou('Not something I handle.');
    }
    return say(content.slice(0, MAX_MESSAGE));
  } catch (err) {
    console.error(err);
    return onlyYou(`Could not reach ESPN: ${err.message}`);
  }
}

/**
 * Post new adds, drops and trades from the ESPN league to the feed channel (#standings).
 *
 * Each move is posted once, tracked by a done-marker per move for the same
 * reason the pick'em job tracks its posts: the feed is re-read every run and
 * overlaps the previous one, so without markers every run would repost it.
 *
 * The first run only records what is already there. Posting a league's whole
 * recent history the moment the bot is switched on would be a wall of old news.
 *
 * Does nothing until the league is configured, so deploying this before
 * FANTASY_LEAGUE_ID is set changes nothing.
 */
export async function runFantasyFeed(env, api, deps = {}) {
  const cfg = fantasyConfig(env);
  if (!cfg || !env.FANTASY_CHANNEL_ID) return { posted: 0, seeded: false };
  const {
    fetchActivity = fantasyFetchActivity,
    alreadyDone = dbAlreadyDone,
    markDone = dbMarkDone,
  } = deps;

  const items = await fetchActivity(cfg, { size: 25 });
  const keyOf = (a) => `fantasy:${cfg.leagueId}:${a.key}`;

  const seededKey = `fantasy:${cfg.leagueId}:seeded`;
  if (!(await alreadyDone(env.DB, seededKey))) {
    for (const a of items) await markDone(env.DB, keyOf(a));
    await markDone(env.DB, seededKey);
    return { posted: 0, seeded: true };
  }

  // Oldest first, so the channel reads in the order things happened.
  const fresh = [];
  for (const a of [...items].reverse()) {
    if (!(await alreadyDone(env.DB, keyOf(a)))) fresh.push(a);
  }

  let posted = 0;
  for (const a of fresh.slice(0, MAX_FEED_POSTS)) {
    // Not caught: a failed post must leave the move unmarked so the next run
    // sends it, and a failed invocation is the only signal anyone sees.
    await api.postMessage(env.FANTASY_CHANNEL_ID, activityLine(a));
    await markDone(env.DB, keyOf(a));
    posted += 1;
  }
  return { posted, seeded: false };
}

// ------------------------------------------------------------ fantasy trades

/** Who may not vote on a trade: the proposer and whoever runs the other team. */
async function excludedVoters(db, trade) {
  const other = await linkForTeam(db, trade.season, trade.toTeam);
  const ids = [trade.proposerId];
  if (other && other.userId !== trade.proposerId) ids.push(other.userId);
  return { ids, otherUserId: other?.userId ?? null };
}

/** Rewrite a trade's card for its final state and take the buttons off. */
async function closeCard(env, api, trade, status, reason = '') {
  if (!trade.messageId || !trade.channelId) return;
  const ex = await excludedVoters(env.DB, trade);
  const tally = tallyVotes(await tradeVotes(env.DB, trade.id), ex.ids);
  await api.editMessage(trade.channelId, trade.messageId, {
    content: closedMessage({ trade, tally, status, reason }),
    components: [],
    allowed_mentions: { parse: [] },
  });
}

const words = (status) => status.replace('_', ' ');

/**
 * /trade propose | approve | veto | cancel.
 *
 * The bot only records and reports. A trade is still made in ESPN, by the two
 * managers; approving or vetoing here is the server's verdict on it, not an
 * action ESPN can see.
 */
export async function handleTrade(interaction, env, api, deps = {}) {
  const { fetchRosters = fantasyFetchRosters, now = Date.now() } = deps;
  const cfg = fantasyConfig(env);
  if (!cfg) return onlyYou('The fantasy league has not been connected yet.');
  const userId = interaction.member?.user?.id ?? interaction.user?.id;
  const isMod = hasManageMessages(interaction.member);
  const { name: sub, args } = subcommandOf(interaction);

  // Discord can only hide a whole command, never one subcommand, so these two
  // are visible to everyone and refused here. See shared/commands.mjs.
  if (TRADE_MOD_ONLY.includes(sub) && !isMod) {
    return onlyYou('Only mods can do that. You can `/trade propose` and `/trade cancel` your own.');
  }

  if (sub === 'propose') {
    const mine = await getLink(env.DB, cfg.season, userId);
    if (!mine) return onlyYou('Link your team first with `/fantasy link`.');

    const ids = (keys) => keys.map((k) => args[k]).filter((v) => v !== undefined && v !== '').map(Number);
    const giveIds = ids(['give', 'give2', 'give3']);
    const getIds = ids(['get', 'get2', 'get3']);
    const toTeamId = Number(args.team);
    if ([...giveIds, ...getIds, toTeamId].some((n) => !Number.isInteger(n))) {
      return onlyYou('Pick the team and players from the lists as you type.');
    }

    const rosters = await fetchRosters(cfg);
    const live = await dbLiveTrades(env.DB, cfg.season);
    const v = validateProposal({
      mine, toTeamId, giveIds, getIds, rosters, live, deadline: rosters.tradeDeadline, now,
    });
    if (!v.ok) return onlyYou(v.error);

    const hours = Number(env.TRADE_VOTE_HOURS) > 0 ? Number(env.TRADE_VOTE_HOURS) : DEFAULT_VOTE_HOURS;
    const trade = {
      season: cfg.season,
      proposerId: userId,
      fromTeam: v.from.id,
      toTeam: v.to.id,
      fromName: v.from.name,
      toName: v.to.name,
      give: v.give,
      get: v.get,
      note: clean(args.note ?? '', MAX_NOTE),
      status: 'open',
      createdAt: new Date(now).toISOString(),
      closesAt: new Date(now + hours * 3_600_000).toISOString(),
    };
    trade.id = await createTrade(env.DB, trade);

    const other = await linkForTeam(env.DB, cfg.season, v.to.id);
    const channel = env.TRADE_CHANNEL_ID || interaction.channel_id;
    let posted;
    try {
      posted = await api.postMessage(
        channel,
        proposalMessage({ trade, tally: tallyVotes([]), otherUserId: other?.userId }),
        // The one deliberate ping: the other manager, so they know it exists.
        { parse: [], users: other ? [other.userId] : [] },
        { components: voteComponents(trade.id) }
      );
    } catch (err) {
      // A proposal nobody can see or vote on must not keep its players locked.
      await resolveTrade(env.DB, trade.id, ['open'], 'cancelled');
      throw err;
    }
    await setTradeMessage(env.DB, trade.id, channel, posted.id);
    return onlyYou(`Posted as trade #${trade.id} in <#${channel}>. The server has ${hours} hours to vote.`);
  }

  const trade = await getTrade(env.DB, Number(args.trade));
  if (!trade || trade.season !== cfg.season) return onlyYou(`There is no trade #${args.trade}.`);

  if (sub === 'cancel') {
    if (trade.proposerId !== userId && !isMod) {
      return onlyYou('Only the person who proposed it, or a mod, can cancel it.');
    }
    if (trade.status !== 'open') return onlyYou(`Trade #${trade.id} is already ${words(trade.status)}.`);
    if (!(await resolveTrade(env.DB, trade.id, ['open'], 'cancelled'))) {
      return onlyYou('Something changed that trade just now. Try again.');
    }
    await closeCard(env, api, trade, 'cancelled').catch((e) => console.warn(`card: ${e.message}`));
    return say(`Trade #${trade.id} was cancelled.`);
  }

  // approve | veto: open to any live trade, since a mod may overrule a result.
  if (!LIVE.includes(trade.status)) return onlyYou(`Trade #${trade.id} is already ${words(trade.status)}.`);
  const to = sub === 'approve' ? 'approved' : 'vetoed';
  if (!(await resolveTrade(env.DB, trade.id, LIVE, to))) {
    return onlyYou('Something changed that trade just now. Try again.');
  }
  await closeCard(env, api, trade, to).catch((e) => console.warn(`card: ${e.message}`));
  return say(
    to === 'approved'
      ? `Trade #${trade.id} was approved by a mod. ${clean(trade.fromName)} and ${clean(trade.toName)} can process it in ESPN.`
      : `Trade #${trade.id} was vetoed by a mod. It should not go through. The bot cannot block it in ESPN, so the managers (or the commissioner) need to act on this.`
  );
}

/** A press on one of a trade card's vote buttons. */
export async function handleTradeVote(interaction, env, api, deps = {}) {
  const { now = Date.now() } = deps;
  const parsed = parseCustomId(interaction.data?.custom_id);
  if (!parsed) return onlyYou('Not something I handle.');
  const userId = interaction.member?.user?.id ?? interaction.user?.id;

  const trade = await getTrade(env.DB, parsed.tradeId);
  if (!trade) return onlyYou('That trade no longer exists.');
  if (trade.status !== 'open' || now >= Date.parse(trade.closesAt)) {
    return onlyYou('Voting on this trade has closed.');
  }
  const ex = await excludedVoters(env.DB, trade);
  if (ex.ids.includes(userId)) return onlyYou('You’re part of this trade, so you can’t vote on it.');

  await castVote(env.DB, trade.id, userId, parsed.vote, new Date(now).toISOString());
  const tally = tallyVotes(await tradeVotes(env.DB, trade.id), ex.ids);

  // Redraw the shared card from the database rather than from this one click,
  // so two votes landing together each show the other's.
  try {
    // Always the stored card, never the message that was clicked: a vote
    // pressed inside the private Explore panel is on the panel, not the card.
    await api.editMessage(trade.channelId, trade.messageId, {
      content: proposalMessage({ trade, tally, otherUserId: ex.otherUserId }),
      components: voteComponents(trade.id),
      allowed_mentions: { parse: [] },
    });
  } catch (err) {
    // The vote itself is saved; a stale count on the card heals on the next press.
    console.warn(`Could not redraw trade #${trade.id}: ${err.message}`);
  }
  return onlyYou(`Vote recorded: **${voteLabel(parsed.vote)}**. You can change it until voting closes.`);
}

/**
 * The Explore button on a trade card, and the tabs inside the panel it opens.
 *
 * The panel is private to whoever pressed the button, so it can be as long as
 * it needs to be without cluttering the channel. Pressing Explore opens it as
 * a new private message; pressing a tab rewrites that same message.
 */
export async function handleTradeExplore(interaction, env, deps = {}) {
  const { fetchCards = fantasyFetchPlayerCards, fetchRosters = fantasyFetchRosters, now = Date.now() } = deps;
  const refuse = (text) => ({ update: false, data: onlyYou(text) });
  const cfg = fantasyConfig(env);
  if (!cfg) return refuse('The fantasy league has not been connected yet.');
  const parsed = parseExploreId(interaction.data?.custom_id);
  if (!parsed) return refuse('Not something I handle.');

  const trade = await getTrade(env.DB, parsed.tradeId);
  if (!trade) return refuse('That trade no longer exists.');

  let cards;
  let cats;
  try {
    [cards, cats] = await Promise.all([
      fetchCards(cfg, [...trade.give, ...trade.get].map((p) => p.id)),
      // Which categories this league scores. Not worth failing the panel for:
      // without it the tables show every category rather than none.
      fetchRosters(cfg).then((r) => categoriesFrom(r.categories)).catch(() => categoriesFrom(null)),
    ]);
  } catch (err) {
    console.error(err);
    return refuse(`Could not reach ESPN: ${err.message}`);
  }

  const ex = await excludedVoters(env.DB, trade);
  const tally = tallyVotes(await tradeVotes(env.DB, trade.id), ex.ids);
  const open = trade.status === 'open' && now < Date.parse(trade.closesAt);
  return {
    // A tab press rewrites the panel; the Explore button opens a new one.
    update: String(interaction.data.custom_id).startsWith('tx:'),
    data: {
      content: exploreMessage({ trade, cards, tab: parsed.tab, tally, open, cats }),
      components: exploreComponents(trade.id, parsed.tab, open),
      flags: PRIVATE,
      allowed_mentions: { parse: [] },
    },
  };
}

/** /player <name>: a public card for any player, with a chart of recent form. */
export async function handlePlayer(interaction, env, deps = {}) {
  const {
    fetchRosters = fantasyFetchRosters,
    fetchCards = fantasyFetchPlayerCards,
    fetchBio = fantasyFetchBio,
  } = deps;
  const cfg = fantasyConfig(env);
  if (!cfg) return onlyYou('The fantasy league has not been connected yet.');
  const id = Number(optionsOf(interaction).name);
  if (!Number.isInteger(id)) return onlyYou('Pick a player from the list as you type.');

  try {
    // Fifteen games, so there is something to draw; the trade panel asks for none.
    const [rosters, cards, bio] = await Promise.all([
      fetchRosters(cfg), fetchCards(cfg, [id], { games: 15 }), fetchBio(id),
    ]);
    const card = cards.get(id);
    if (!card) return onlyYou('ESPN has no card for that player.');
    const owner = rosters.teams.find((t) => t.players.some((p) => p.id === id))?.name ?? null;
    const cats = categoriesFrom(rosters.categories);
    const chart = chartData(card, cats, cfg.season);
    return {
      embeds: [playerEmbed({
        card, owner, bio, cats,
        chartUrl: chart ? areaChartUrl({ title: chart.title, values: chart.values }) : null,
      })],
      allowed_mentions: { parse: [] },
    };
  } catch (err) {
    console.error(err);
    return onlyYou(`Could not reach ESPN: ${err.message}`);
  }
}

/** /compare: two to four players side by side, with a chart of their recent games. */
export async function handleCompare(interaction, env, deps = {}) {
  const { fetchRosters = fantasyFetchRosters, fetchCards = fantasyFetchPlayerCards } = deps;
  const cfg = fantasyConfig(env);
  if (!cfg) return onlyYou('The fantasy league has not been connected yet.');

  const opts = optionsOf(interaction);
  const ids = ['player1', 'player2', 'player3', 'player4']
    .map((k) => opts[k])
    .filter((v) => v !== undefined && v !== '')
    .map(Number);
  if (ids.length < 2) return onlyYou('Pick at least two players to compare.');
  if (ids.some((n) => !Number.isInteger(n))) return onlyYou('Pick the players from the list as you type.');
  if (new Set(ids).size !== ids.length) return onlyYou('Pick different players: the same one is listed twice.');

  try {
    // One card request for all of them: a comparison costs no more ESPN calls
    // than looking up one player.
    const [rosters, cards] = await Promise.all([fetchRosters(cfg), fetchCards(cfg, ids, { games: 15 })]);
    const missing = ids.filter((id) => !cards.has(id));
    if (missing.length) return onlyYou(`ESPN has no card for player ${missing.join(', ')}.`);
    const owners = new Map(rosters.teams.flatMap((t) => t.players.map((p) => [p.id, t.name])));
    return {
      embeds: [compareEmbed({
        cards: ids.map((id) => cards.get(id)),
        owners,
        cats: categoriesFrom(rosters.categories),
        season: cfg.season,
      })],
      allowed_mentions: { parse: [] },
    };
  } catch (err) {
    console.error(err);
    return onlyYou(`Could not reach ESPN: ${err.message}`);
  }
}

/**
 * Autocomplete for /player: anyone ESPN knows, rostered or not.
 *
 * From three letters on it asks ESPN's player search, so an undrafted player
 * (draft night) or a free agent can be looked up. Rostered players in this
 * league are always matched locally, and show their team, so the list still
 * works with ESPN's search down or before three letters are typed.
 */
export async function handlePlayerAutocomplete(interaction, env, deps = {}) {
  const { fetchRosters = fantasyFetchRosters, searchPlayers = fantasySearchPlayers } = deps;
  const cfg = fantasyConfig(env);
  if (!cfg) return [];
  const focused = (interaction.data?.options ?? []).find((o) => o.focused);
  if (!focused) return [];
  const typed = String(focused.value ?? '').trim();
  const lower = typed.toLowerCase();

  const rosters = await fetchRosters(cfg);
  const owner = new Map(rosters.teams.flatMap((t) => t.players.map((p) => [p.id, t.name])));
  const rostered = rosters.teams
    .flatMap((t) => t.players.map((p) => ({ id: p.id, name: p.name, position: '', proTeam: '' })))
    .filter((p) => p.name.toLowerCase().includes(lower))
    .sort((a, b) => a.name.localeCompare(b.name));

  let found = [];
  if (typed.length >= 3) {
    try {
      found = await searchPlayers(cfg, typed);
    } catch (err) {
      // Fall back to the local list rather than showing nothing.
      console.warn(`Player search failed: ${err.message}`);
    }
  }

  const label = (p) => owner.has(p.id)
    ? `${p.name} (${owner.get(p.id)})`
    : `${p.name} (${[p.position, p.proTeam].filter(Boolean).join(', ') || 'not on a team'})`;
  const seen = new Set();
  const merged = [];
  for (const p of [...found, ...rostered]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    merged.push(p);
  }
  return merged.slice(0, 25).map((p) => ({ name: label(p).slice(0, 100), value: String(p.id) }));
}

/** Close every trade whose time is up, announcing how it ended. */
export async function runTradeClose(env, api, deps = {}) {
  const cfg = fantasyConfig(env);
  if (!cfg) return { closed: 0 };
  const { now = Date.now(), alreadyDone = dbAlreadyDone, markDone = dbMarkDone } = deps;

  let closed = 0;
  const failures = [];
  for (const trade of await dueTrades(env.DB, new Date(now).toISOString())) {
    try {
      const ex = await excludedVoters(env.DB, trade);
      const tally = tallyVotes(await tradeVotes(env.DB, trade.id), ex.ids);
      const decision = decide(tally);
      // In this order, like the pick'em job: the card and the announcement can
      // be repeated safely (the announcement has a marker), the status change
      // is the step that ends it, so it goes last and a failure retries.
      await closeCard(env, api, trade, decision.status, decision.reason);
      const key = `trade:${trade.id}:announced`;
      if (!(await alreadyDone(env.DB, key))) {
        await api.postMessage(trade.channelId, resultAnnouncement({ trade, tally, decision }));
        await markDone(env.DB, key);
      }
      if (await resolveTrade(env.DB, trade.id, ['open'], decision.status)) closed += 1;
    } catch (err) {
      console.error(`Closing trade #${trade.id} failed: ${err.message}`);
      failures.push(`#${trade.id}: ${err.message}`);
    }
  }
  // One bad trade must not strand the others, but it must still show as a
  // failed invocation, the only signal anyone sees.
  if (failures.length) throw new Error(failures.join('; '));
  return { closed };
}

/**
 * Notice trades ESPN has processed and mark their cards completed.
 *
 * Asks ESPN only when a trade is actually waiting, so a quiet league costs
 * nothing extra every ten minutes.
 */
export async function runTradeSync(env, api, deps = {}) {
  const cfg = fantasyConfig(env);
  if (!cfg) return { completed: 0 };
  const { fetchActivity = fantasyFetchActivity, liveTrades = dbLiveTrades } = deps;
  const waiting = await liveTrades(env.DB, cfg.season);
  if (waiting.length === 0) return { completed: 0 };

  let completed = 0;
  for (const trade of findCompletedTrades(await fetchActivity(cfg, { size: 25 }), waiting)) {
    if (!(await resolveTrade(env.DB, trade.id, LIVE, 'completed'))) continue;
    await closeCard(env, api, trade, 'completed').catch((e) => console.warn(`card: ${e.message}`));
    completed += 1;
  }
  return { completed };
}

/** Autocomplete for /trade propose and /fantasy link, from the live rosters. */
export async function handleFantasyAutocomplete(interaction, env, deps = {}) {
  const { fetchRosters = fantasyFetchRosters } = deps;
  const cfg = fantasyConfig(env);
  if (!cfg) return [];
  const userId = interaction.member?.user?.id ?? interaction.user?.id;
  const { name: sub, args, options } = subcommandOf(interaction);
  const focused = options.find((o) => o.focused);
  if (!focused) return [];

  const typed = String(focused.value ?? '').toLowerCase();
  const rosters = await fetchRosters(cfg);
  const choices = (items) => items
    .filter((x) => x.name.toLowerCase().includes(typed))
    .slice(0, 25)
    .map((x) => ({ name: x.name.slice(0, 100), value: String(x.id) }));

  if (focused.name === 'team') {
    const mine = sub === 'propose' ? await getLink(env.DB, cfg.season, userId) : null;
    return choices(rosters.teams.filter((t) => !mine || t.id !== mine.teamId));
  }
  if (sub === 'debug') {
    const found = choices(rosters.teams.flatMap((t) => t.players.map((p) => ({ id: p.id, name: p.name }))));
    // Anyone can be inspected by ESPN player id, rostered or not, which is the
    // only way in before the draft, when the list above is empty.
    return /^\d+$/.test(typed) ? [{ name: `Player id ${typed}`, value: typed }, ...found].slice(0, 25) : found;
  }
  if (sub !== 'propose') return [];

  // Players: yours to give, theirs to get, never one already picked.
  const taken = new Set(
    ['give', 'give2', 'give3', 'get', 'get2', 'get3']
      .filter((k) => k !== focused.name)
      .map((k) => args[k])
      .filter(Boolean)
      .map(String)
  );
  let team;
  if (focused.name.startsWith('give')) {
    const mine = await getLink(env.DB, cfg.season, userId);
    team = mine && rosters.teams.find((t) => t.id === mine.teamId);
  } else {
    team = rosters.teams.find((t) => String(t.id) === String(args.team));
  }
  return team ? choices(team.players.filter((p) => !taken.has(String(p.id)))) : [];
}

export default {
  async fetch(request, env) {
    // Handled before anything Discord-specific: Discord never calls /picks —
    // a browser does, with no signature — so this must not sit behind the
    // POST-only gate or the Ed25519 signature check below.
    const url = new URL(request.url);
    if (url.pathname === '/picks') {
      // Explicit allowlist: `submitted` is only ever populated for POST, so
      // any other method (PUT, DELETE, …) reaching the submission handling
      // below would dereference `submitted.picks` while `submitted` is still
      // null and crash to a 500 instead of a clean 405.
      if (request.method !== 'GET' && request.method !== 'POST') {
        return new Response('This endpoint only accepts GET and POST.', { status: 405 });
      }
      // A public, unauthenticated endpoint: a malformed body (non-JSON, or
      // literal JSON null) must come back as a 400, not crash into a 500 —
      // mirroring how the signed Discord path below handles bad JSON.
      let submitted = null;
      if (request.method === 'POST') {
        try {
          submitted = await request.json();
        } catch {
          return json({ error: 'That submission was not readable.' }, 400);
        }
        if (!submitted || typeof submitted !== 'object') {
          return json({ error: 'That submission was not readable.' }, 400);
        }
      }

      const rawToken = request.method === 'POST' ? submitted.token : url.searchParams.get('t');
      const claims = await verifyPickToken(rawToken, env.PICKS_SECRET);
      if (!claims) {
        return new Response(renderMessage('That link has expired — run /picks again.'), {
          status: 401, headers: { 'Content-Type': 'text/html' },
        });
      }
      const games = await getGames(env.DB, claims.season, claims.week);
      const teams = await getTeams(env.DB);

      if (request.method === 'GET') {
        const picks = await getPicks(env.DB, claims.userId, claims.season, claims.week);
        // Defence in depth: never forward the raw external string into the
        // page. Rebuild the token from exactly the two dot-separated
        // segments verifyPickToken just accepted, so anything a caller
        // appended past the second "." can never reach renderForm even if
        // the verifier's own segment-count guard ever regressed.
        const safeToken = rawToken.split('.').slice(0, 2).join('.');
        return new Response(
          renderForm({
            games, teams, picks, token: safeToken,
            lockAt: lockTime(games), guildId: env.GUILD_ID,
          }),
          { headers: { 'Content-Type': 'text/html' } }
        );
      }

      const result = validateSubmission({ games, submission: submitted.picks, now: Date.now() });
      if (!result.ok) return json({ error: result.error }, 400);
      await savePicks(env.DB, {
        userId: claims.userId, season: claims.season, week: claims.week, picks: result.picks,
      });
      return json({ ok: true });
    }

    if (request.method !== 'POST') {
      return new Response('This endpoint is for Discord interactions.', { status: 405 });
    }

    // Read the body as text: the signature covers the exact bytes sent.
    const body = await request.text();
    const ok = await isFromDiscord({
      publicKey: env.DISCORD_PUBLIC_KEY,
      signature: request.headers.get('x-signature-ed25519'),
      timestamp: request.headers.get('x-signature-timestamp'),
      body,
    });
    // Discord registers an endpoint only if bad signatures come back as 401.
    if (!ok) return new Response('invalid request signature', { status: 401 });

    let interaction;
    try {
      interaction = JSON.parse(body);
    } catch {
      return new Response('bad json', { status: 400 });
    }

    if (interaction.type === PING) return json({ type: PONG });

    if (interaction.type === APPLICATION_COMMAND && interaction.data?.name === 'lfg') {
      const api = createApi(env.DISCORD_TOKEN);
      try {
        return json({ type: REPLY, data: await handleLfg(interaction, env, api) });
      } catch (err) {
        console.error(err);
        return json({ type: REPLY, data: { content: `Could not start that: ${err.message}`, flags: 64 } });
      }
    }

    if (interaction.type === APPLICATION_COMMAND && interaction.data?.name === 'picks') {
      const userId = interaction.member?.user?.id ?? interaction.user?.id;
      const season = Number(env.SEASON);
      const week = await openWeek(env.DB, season);
      if (!week) {
        return json({ type: REPLY, data: { content: 'No week is open right now.', flags: 64 } });
      }
      const games = await getGames(env.DB, season, week);
      const exp = lockTime(games);
      if (Date.now() >= exp) {
        // openWeek stays on this week until the cron scores it, so this reply
        // is all the pick'em says for the several days between lock and
        // scoring. It has to point somewhere.
        return json({
          type: REPLY,
          data: {
            content: lockedMessage({
              week,
              games,
              leaderboardChannelId: env.LEADERBOARD_CHANNEL_ID,
            }),
            flags: 64,
          },
        });
      }
      const token = await signPickToken({ userId, season, week, exp }, env.PICKS_SECRET);
      const link = `${url.origin}/picks?t=${token}`;
      return json({ type: REPLY, data: { content: `Your Week ${week} picks: ${link}`, flags: 64 } });
    }

    if (interaction.type === APPLICATION_COMMAND && interaction.data?.name === 'leaderboard') {
      const season = Number(env.SEASON);

      // Only weeks that have actually been scored count. openWeek is the first
      // week with an unfinished game, so everything below it is settled — and
      // showing a half-finished week here would contradict the whole all-or-
      // nothing rule the weekly job enforces.
      const open = await openWeek(env.DB, season);
      const through = open ? open - 1 : MAX_WEEKS;

      const weeks = [];
      for (let w = 1; w <= through; w += 1) {
        const games = await getGames(env.DB, season, w);
        if (games.length === 0) continue;
        weeks.push({ week: w, games, picks: await allPicks_(env.DB, season, w) });
      }

      const { rows, weeksPlayed } = scoreSeason(weeks);
      const table = mergeAwards(buildStandings(rows), await dbSeasonAwards(env.DB, season));

      return json({
        type: REPLY,
        data: {
          content: standingsMessage({
            table,
            weeksPlayed,
            leaderboardChannelId: env.LEADERBOARD_CHANNEL_ID,
          }),
          // Names render, nobody gets pinged for someone else checking the board.
          allowed_mentions: { parse: [] },
        },
      });
    }

    if (interaction.type === APPLICATION_COMMAND && interaction.data?.name === 'award') {
      // The command carries default_member_permissions, so Discord already
      // hides it from anyone without Manage Messages. Checked again here
      // because that default can be overridden per server in Integrations,
      // and a command that hands out season points should not rely on a
      // setting someone else can change.
      if (!hasManageMessages(interaction.member)) {
        return json({
          type: REPLY,
          data: { content: 'Only mods can award points.', flags: 64 },
        });
      }

      const { user: userId, points, reason } = optionsOf(interaction);
      const award = validateAward({ points, reason });
      if (!award.ok) {
        return json({ type: REPLY, data: { content: award.error, flags: 64 } });
      }

      await awardPoints(env.DB, {
        season: Number(env.SEASON),
        userId,
        amount: award.points,
        reason: award.reason,
        awardedBy: interaction.member?.user?.id ?? 'unknown',
      });

      // Public on purpose. Season points are a scoreboard, and one handed out
      // quietly is one nobody can question.
      const sign = award.points > 0 ? '+' : '';
      return json({
        type: REPLY,
        data: {
          content: `${sign}${award.points} to <@${userId}> — ${award.reason}`,
          allowed_mentions: { parse: [] },
        },
      });
    }

    if (interaction.type === APPLICATION_COMMAND && interaction.data?.name === 'fantasy') {
      return json({ type: REPLY, data: await handleFantasy(interaction, env) });
    }

    if (interaction.type === APPLICATION_COMMAND && interaction.data?.name === 'player') {
      return json({ type: REPLY, data: await handlePlayer(interaction, env) });
    }

    if (interaction.type === APPLICATION_COMMAND && interaction.data?.name === 'compare') {
      return json({ type: REPLY, data: await handleCompare(interaction, env) });
    }

    if (interaction.type === AUTOCOMPLETE && (interaction.data?.name === 'player' || interaction.data?.name === 'compare')) {
      try {
        return json({
          type: AUTOCOMPLETE_RESULT,
          data: { choices: await handlePlayerAutocomplete(interaction, env) },
        });
      } catch (err) {
        console.error(err);
        return json({ type: AUTOCOMPLETE_RESULT, data: { choices: [] } });
      }
    }

    if (interaction.type === APPLICATION_COMMAND && interaction.data?.name === 'trade') {
      try {
        return json({
          type: REPLY,
          data: await handleTrade(interaction, env, createApi(env.DISCORD_TOKEN)),
        });
      } catch (err) {
        console.error(err);
        return json({ type: REPLY, data: onlyYou(`Could not do that: ${err.message}`) });
      }
    }

    // The Explore button and the panel's tabs.
    if (interaction.type === MESSAGE_COMPONENT && parseExploreId(interaction.data?.custom_id)) {
      try {
        const out = await handleTradeExplore(interaction, env);
        return json({ type: out.update ? UPDATE_MESSAGE : REPLY, data: out.data });
      } catch (err) {
        console.error(err);
        return json({ type: REPLY, data: onlyYou(`Could not open that: ${err.message}`) });
      }
    }

    // A press on a vote button. Only trade cards carry components so far.
    if (interaction.type === MESSAGE_COMPONENT && String(interaction.data?.custom_id).startsWith('trade:')) {
      try {
        return json({
          type: REPLY,
          data: await handleTradeVote(interaction, env, createApi(env.DISCORD_TOKEN)),
        });
      } catch (err) {
        console.error(err);
        return json({ type: REPLY, data: onlyYou(`Could not record that: ${err.message}`) });
      }
    }

    if (
      interaction.type === AUTOCOMPLETE &&
      (interaction.data?.name === 'trade' || interaction.data?.name === 'fantasy')
    ) {
      try {
        return json({
          type: AUTOCOMPLETE_RESULT,
          data: { choices: await handleFantasyAutocomplete(interaction, env) },
        });
      } catch (err) {
        console.error(err);
        return json({ type: AUTOCOMPLETE_RESULT, data: { choices: [] } });
      }
    }

    // Fires as the user types into /bracket report's match option. Discord
    // gives the whole round trip about three seconds, which is why entrant
    // names are stored at sign-up instead of fetched here.
    if (interaction.type === AUTOCOMPLETE && interaction.data?.name === 'bracket') {
      try {
        return json({
          type: AUTOCOMPLETE_RESULT,
          data: { choices: await handleBracketAutocomplete(interaction, env) },
        });
      } catch (err) {
        // An empty list reads as "no suggestions". Anything else leaves the
        // picker spinning until it times out.
        console.error(err);
        return json({ type: AUTOCOMPLETE_RESULT, data: { choices: [] } });
      }
    }

    if (interaction.type === APPLICATION_COMMAND && interaction.data?.name === 'bracket') {
      try {
        return json({ type: REPLY, data: await handleBracket(interaction, env) });
      } catch (err) {
        console.error(err);
        return json({
          type: REPLY,
          data: { content: `Could not do that: ${err.message}`, flags: PRIVATE },
        });
      }
    }

    return json({ type: REPLY, data: { content: 'Not something I handle.', flags: 64 } });
  },

  async scheduled(event, env) {
    const api = createApi(env.DISCORD_TOKEN);
    // The frequent trigger runs only the fantasy feed. The daily one keeps
    // doing promotions and the pick'em, and is also the default when no cron
    // is named, so nothing that called this before changes behaviour.
    if (event?.cron === FANTASY_CRON) {
      // Three independent jobs on one trigger: one failing must not stop the
      // others, but it must still fail the invocation.
      const failures = [];
      try {
        const out = await runFantasyFeed(env, api);
        console.log(`Fantasy feed: ${out.seeded ? 'seeded' : `${out.posted} posted`}.`);
      } catch (err) {
        console.error(`Fantasy feed failed: ${err.message}`);
        failures.push(`feed: ${err.message}`);
      }
      try {
        const out = await runTradeClose(env, api);
        console.log(`Trades: ${out.closed} closed.`);
      } catch (err) {
        console.error(`Trade close failed: ${err.message}`);
        failures.push(`trades: ${err.message}`);
      }
      try {
        const out = await runTradeSync(env, api);
        console.log(`Trades: ${out.completed} completed in ESPN.`);
      } catch (err) {
        console.error(`Trade sync failed: ${err.message}`);
        failures.push(`trade sync: ${err.message}`);
      }
      if (failures.length) throw new Error(failures.join('; '));
      return;
    }
    return runCron(env, api);
  },
};
