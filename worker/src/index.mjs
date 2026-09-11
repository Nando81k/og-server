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
import { validateSubmission, lockTime } from './validate.mjs';
import {
  getGames, getPicks, savePicks, openWeek,
  upsertGames as dbUpsert, setResults as dbSetResults, allPicks as dbAllPicks,
  upsertTeams as dbUpsertTeams, getTeams,
  alreadyDone as dbAlreadyDone, markDone as dbMarkDone,
} from './db.mjs';
import { fetchWeek as espnFetchWeek, fetchCurrentWeek as espnFetchCurrentWeek } from './espn.mjs';
import { scoreWeek, buildStandings } from './scoring.mjs';
import { weekOneAnnouncement, lockedMessage } from './announce.mjs';

const PING = 1;
const APPLICATION_COMMAND = 2;
const PONG = 1;
const REPLY = 4;

/** Discord channel type for a guild voice channel. */
const GUILD_VOICE = 2;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function optionsOf(interaction) {
  const out = {};
  for (const o of interaction?.data?.options ?? []) out[o.name] = o.value;
  return out;
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
  // second run of this job produce identical numbers.
  const rows = [];
  let seasonWeeks = 0;
  for (let w = 1; w <= week; w += 1) {
    const weekGames = w === week ? settled : await getGames_(env.DB, season, w);
    if (weekGames.length === 0) continue;
    seasonWeeks += 1;
    const weekPicks = await allPicks(env.DB, season, w);
    const byUser = new Map();
    for (const p of weekPicks) {
      if (!byUser.has(p.userId)) byUser.set(p.userId, []);
      byUser.get(p.userId).push(p);
    }
    for (const [userId, theirs] of byUser) {
      const { points, correct } = scoreWeek({ games: weekGames, picks: theirs });
      rows.push({ userId, points, correct, week: w });
    }
  }

  const table = buildStandings(rows);
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

    return json({ type: REPLY, data: { content: 'Not something I handle.', flags: 64 } });
  },

  async scheduled(event, env) {
    const api = createApi(env.DISCORD_TOKEN);
    const promo = await runPromotions(env, api);
    console.log(`Promotion pass: ${promo.promoted} promoted, ${promo.skipped} not due yet.`);
    const week = await runWeekly(env, api);
    console.log(`Pick'em: scored ${week.scored ?? 'nothing'}, synced ${week.synced ?? 'nothing'}.`);
  },
};
