/**
 * ESPN fantasy basketball, read straight from ESPN's league API.
 *
 * There is no official public API for this. The endpoints and response shapes
 * below are the ones the community `espn-api` Python library has used for
 * years; they are stable in practice but ESPN can change them without notice,
 * so every parser here fails loudly on a shape it does not recognise rather
 * than posting nonsense to the server.
 *
 * Private leagues need two cookies from a logged-in ESPN session, `espn_s2`
 * and `SWID`. They are the account's credentials: they live in Cloudflare
 * secrets (ESPN_S2, ESPN_SWID), never in this repo or in wrangler.toml.
 */

const BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba';

/**
 * ESPN's transaction message type ids, as the activity feed reports them.
 * 188 (a lineup slot change) is deliberately absent: it is noise in a feed
 * meant for adds, drops and trades.
 */
export const ACTIVITY_KINDS = {
  178: 'added (free agent)',
  180: 'added (waivers)',
  179: 'dropped',
  181: 'dropped',
  239: 'dropped',
  244: 'traded',
};

/** The message type ids worth asking ESPN for. */
export const ACTIVITY_TYPE_IDS = Object.keys(ACTIVITY_KINDS).map(Number);

/** What the config looks like when the league has not been set up. */
export function fantasyConfig(env) {
  if (!env.FANTASY_LEAGUE_ID) return null;
  return {
    leagueId: String(env.FANTASY_LEAGUE_ID),
    season: Number(env.FANTASY_SEASON),
    espnS2: env.ESPN_S2 || '',
    swid: env.ESPN_SWID || '',
  };
}

export function leagueUrl({ leagueId, season }) {
  return `${BASE}/seasons/${season}/segments/0/leagues/${leagueId}`;
}

function headersFor({ espnS2, swid }, filter) {
  const headers = { 'User-Agent': 'og-server', Accept: 'application/json' };
  if (espnS2 && swid) headers.Cookie = `espn_s2=${espnS2}; SWID=${swid}`;
  if (filter) headers['x-fantasy-filter'] = JSON.stringify(filter);
  return headers;
}

async function get(cfg, { path = '', views = [], filter, unwrap = false, fetchImpl = fetch }) {
  const query = views.map((v) => `view=${encodeURIComponent(v)}`).join('&');
  const url = `${leagueUrl(cfg)}${path}${query ? `?${query}` : ''}`;
  const res = await fetchImpl(url, { headers: headersFor(cfg, filter) });
  if (res.status === 401) {
    throw new Error(
      'ESPN refused the request (401). If the league is private, ESPN_S2 and ESPN_SWID are missing or expired.'
    );
  }
  if (res.status === 404) throw new Error('ESPN could not find that league. Check FANTASY_LEAGUE_ID and FANTASY_SEASON.');
  if (!res.ok) throw new Error(`ESPN ${res.status}`);
  const json = await res.json();
  // Some league responses are wrapped in a one-element array. Only those:
  // the player list is a real list and must not be collapsed to its first row.
  return unwrap && Array.isArray(json) ? json[0] : json;
}

export function teamName(team) {
  if (team?.name) return team.name;
  const joined = [team?.location, team?.nickname].filter(Boolean).join(' ');
  return joined || `Team ${team?.id ?? '?'}`;
}

/** Teams, in standings order, with the record ESPN reports for each. */
export function parseStandings(json) {
  if (!Array.isArray(json?.teams)) throw new Error('Malformed payload: missing teams');
  return json.teams
    .map((t) => {
      const overall = t.record?.overall;
      if (!overall) throw new Error(`Malformed team ${t.id}: missing record`);
      return {
        id: t.id,
        name: teamName(t),
        wins: overall.wins ?? 0,
        losses: overall.losses ?? 0,
        ties: overall.ties ?? 0,
        // 0 means ESPN has not seeded the team yet (before week 1).
        seed: t.playoffSeed || 0,
      };
    })
    .sort((a, b) => (a.seed || 99) - (b.seed || 99) || b.wins - a.wins || a.id - b.id);
}

/**
 * The matchups of one period, with each side's running score.
 *
 * Category leagues report a W-L-T tally per side in cumulativeScore; points
 * leagues report totalPoints. Both are carried so the formatter can show
 * whichever the league actually uses.
 */
export function parseMatchups(json, period) {
  if (!Array.isArray(json?.schedule)) throw new Error('Malformed payload: missing schedule');
  const wanted = period ?? json.status?.currentMatchupPeriod;
  if (wanted === undefined) throw new Error('Malformed payload: missing matchup period');
  const names = new Map((json.teams ?? []).map((t) => [t.id, teamName(t)]));

  const side = (s) => ({
    id: s.teamId,
    name: names.get(s.teamId) ?? `Team ${s.teamId}`,
    points: s.totalPoints ?? 0,
    tally: s.cumulativeScore && s.cumulativeScore.wins !== undefined
      ? { wins: s.cumulativeScore.wins, losses: s.cumulativeScore.losses, ties: s.cumulativeScore.ties }
      : null,
  });

  return {
    period: wanted,
    matchups: json.schedule
      .filter((m) => m.matchupPeriodId === wanted && m.home && m.away)
      .map((m) => ({ home: side(m.home), away: side(m.away) })),
  };
}

/**
 * Adds, drops and trades from the league's activity feed, newest first.
 *
 * `names` maps ESPN team ids to names and `players` maps player ids to names;
 * both come from calls the caller makes first. The key is stable across
 * fetches, which is what lets the feed post each move exactly once.
 */
export function parseActivity(json, { teams, players }) {
  if (!Array.isArray(json?.topics)) throw new Error('Malformed payload: missing topics');
  const out = [];
  for (const topic of json.topics) {
    for (const msg of topic.messages ?? []) {
      const kind = ACTIVITY_KINDS[msg.messageTypeId];
      if (!kind) continue;
      // Which field names the team depends on the message: a trade is
      // reported from the giving side, a drop "for" the dropping team.
      const teamId = msg.messageTypeId === 244 ? msg.from
        : msg.messageTypeId === 239 ? msg.for
        : msg.to;
      out.push({
        key: `${topic.date}|${msg.messageTypeId}|${msg.targetId}|${teamId}`,
        date: topic.date,
        team: teams.get(teamId) ?? `Team ${teamId}`,
        kind,
        playerId: msg.targetId,
        player: players.get(msg.targetId) ?? `Player ${msg.targetId}`,
      });
    }
  }
  return out;
}

export async function fetchLeague(cfg, deps = {}) {
  return get(cfg, { views: ['mTeam', 'mMatchup', 'mSettings'], unwrap: true, ...deps });
}

/** Player names for a set of ids, asked for by id so the whole pool is never downloaded. */
export async function fetchPlayerNames(cfg, ids, deps = {}) {
  if (ids.length === 0) return new Map();
  const res = await get(cfg, {
    path: '/players',
    views: ['players_wl'],
    filter: { players: { filterIds: { value: ids } } },
    ...deps,
  });
  if (!Array.isArray(res)) throw new Error('Malformed payload: players is not a list');
  return new Map(res.map((p) => [p.id, p.fullName]));
}

export async function fetchActivity(cfg, { size = 25, ...deps } = {}) {
  const [league, feed] = await Promise.all([
    fetchLeague(cfg, deps),
    get(cfg, {
      path: '/communication/',
      views: ['kona_league_communication'],
      unwrap: true,
      filter: {
        topics: {
          filterType: { value: ['ACTIVITY_TRANSACTIONS'] },
          limit: size,
          limitPerMessageSet: { value: 25 },
          offset: 0,
          sortMessageDate: { sortPriority: 1, sortAsc: false },
          sortFor: { sortPriority: 2, sortAsc: false },
          filterIncludeMessageTypeIds: { value: ACTIVITY_TYPE_IDS },
        },
      },
      ...deps,
    }),
  ]);
  const teams = new Map((league.teams ?? []).map((t) => [t.id, teamName(t)]));
  const ids = [...new Set((feed.topics ?? []).flatMap((t) => (t.messages ?? []).map((m) => m.targetId)))];
  const players = await fetchPlayerNames(cfg, ids.filter((id) => id !== undefined), deps);
  return parseActivity(feed, { teams, players });
}

// ------------------------------------------------------------------- rosters

/**
 * Every team with its players, and the trade deadline if the league sets one.
 *
 * Players come from each team's roster entries; the id is ESPN's player id,
 * the same one the activity feed reports, which is what lets a processed trade
 * be matched back to a proposal. The deadline lives in the league settings
 * (tradeSettings.deadlineDate, epoch ms) as far as the espn-api library's data
 * shows. It has not been confirmed against a live league: if the field isn't
 * there the deadline is simply not enforced, and ESPN still refuses a late
 * trade itself.
 */
export function parseRosters(json) {
  if (!Array.isArray(json?.teams)) throw new Error('Malformed payload: missing teams');
  const teams = json.teams.map((t) => ({
    id: t.id,
    name: teamName(t),
    players: (t.roster?.entries ?? [])
      .map((e) => ({
        id: e.playerId ?? e.playerPoolEntry?.player?.id,
        name: e.playerPoolEntry?.player?.fullName,
      }))
      .filter((p) => p.id !== undefined && p.name),
  }));
  const raw = json.settings?.tradeSettings?.deadlineDate;
  // The categories this league actually scores, from its settings. A league is
  // free to leave one out (this one has no turnovers), and a table that shows
  // a category nobody is playing for is noise at best.
  const items = json.settings?.scoringSettings?.scoringItems;
  const scored = Array.isArray(items)
    ? CATEGORIES.filter((c) => items.some((i) => Number(i.statId) === Number(STAT_ID[c.key]))).map((c) => c.key)
    : [];
  return {
    teams,
    tradeDeadline: typeof raw === 'number' && raw > 0 ? raw : null,
    categories: scored.length ? scored : null,
  };
}

// Autocomplete gets about three seconds for the whole round trip and fires on
// every keystroke, so the same league is asked for once a minute at most. One
// minute is short enough that a roster change shows up before anyone notices.
let rosterCache = { key: '', at: 0, value: null };

export function clearRosterCache() {
  rosterCache = { key: '', at: 0, value: null };
}

export async function fetchRosters(cfg, { ttlMs = 60_000, now = Date.now(), ...deps } = {}) {
  const key = `${cfg.leagueId}:${cfg.season}`;
  if (ttlMs > 0 && rosterCache.key === key && now - rosterCache.at < ttlMs) return rosterCache.value;
  const value = parseRosters(
    await get(cfg, { views: ['mTeam', 'mRoster', 'mSettings'], unwrap: true, ...deps })
  );
  if (ttlMs > 0) rosterCache = { key, at: now, value };
  return value;
}

// -------------------------------------------------------------- player cards

// ESPN's own position and team numbering, as the espn-api library maps it.
// defaultPositionId is 1-based into POSITIONS.
const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'SG/SF', 'G/F', 'PF/C', 'F/C', 'UT'];
const PRO_TEAMS = {
  0: 'FA', 1: 'ATL', 2: 'BOS', 3: 'NOP', 4: 'CHI', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET', 9: 'GSW',
  10: 'HOU', 11: 'IND', 12: 'LAC', 13: 'LAL', 14: 'MIA', 15: 'MIL', 16: 'MIN', 17: 'BKN', 18: 'NYK',
  19: 'ORL', 20: 'PHL', 21: 'PHO', 22: 'POR', 23: 'SAC', 24: 'SAS', 25: 'OKC', 26: 'UTA', 27: 'WAS',
  28: 'TOR', 29: 'MEM', 30: 'CHA',
};

/** ESPN's stat ids for the categories shown, keyed by what this code calls them. */
const STAT_ID = { pts: '0', blk: '1', stl: '2', ast: '3', reb: '6', to: '11', tpm: '17', fg: '19', ft: '20', min: '40', gp: '42' };

/** Two-digit prefixes of the stat windows. Any other id is a single game. */
const SPLIT_PREFIXES = new Set(['00', '01', '02', '03', '10']);

/** How many recent games a card keeps for charting. */
const MAX_GAMES = 15;

/** The category columns, in the order they are always shown. */
export const CATEGORIES = [
  { key: 'pts', label: 'PTS', name: 'Points', pct: false, lowerIsBetter: false },
  { key: 'reb', label: 'REB', name: 'Rebounds', pct: false, lowerIsBetter: false },
  { key: 'ast', label: 'AST', name: 'Assists', pct: false, lowerIsBetter: false },
  { key: 'stl', label: 'STL', name: 'Steals', pct: false, lowerIsBetter: false },
  { key: 'blk', label: 'BLK', name: 'Blocks', pct: false, lowerIsBetter: false },
  { key: 'tpm', label: '3PM', name: 'Threes made', pct: false, lowerIsBetter: false },
  { key: 'fg', label: 'FG%', name: 'Field goal %', pct: true, lowerIsBetter: false },
  { key: 'ft', label: 'FT%', name: 'Free throw %', pct: true, lowerIsBetter: false },
  { key: 'to', label: 'TO', name: 'Turnovers', pct: false, lowerIsBetter: true },
];

/**
 * The categories to show: the league's own when known, else all nine.
 * `keys` is the list parseRosters reports; anything unrecognised falls back
 * rather than leaving a table with no rows.
 */
export function categoriesFrom(keys) {
  if (!Array.isArray(keys) || keys.length === 0) return CATEGORIES;
  const list = CATEGORIES.filter((c) => keys.includes(c.key));
  return list.length ? list : CATEGORIES;
}

/**
 * One split's per-game line, or null when there is nothing to show.
 *
 * A player with no games in a split has an entry with empty or zeroed
 * averages; showing that as a row of zeros would read as "scores nothing"
 * rather than "hasn't played", so it is null and the caller says so.
 */
function statLine(split) {
  const avg = split?.averageStats;
  if (!avg || typeof avg[STAT_ID.pts] !== 'number') return null;
  const gp = avg[STAT_ID.gp] ?? split.stats?.[STAT_ID.gp] ?? null;
  if (gp === 0) return null;
  const line = { gp };
  for (const [key, id] of Object.entries(STAT_ID)) {
    if (key !== 'gp') line[key] = typeof avg[id] === 'number' ? avg[id] : null;
  }
  return line;
}

const INJURY = {
  ACTIVE: 'Healthy', DAY_TO_DAY: 'Day-to-day', OUT: 'Out', INJURY_RESERVE: 'Injured reserve',
  SUSPENSION: 'Suspended', DOUBTFUL: 'Doubtful', QUESTIONABLE: 'Questionable', PROBABLE: 'Probable',
};

/**
 * A player's most recent games, oldest first, from the single-game entries in
 * his stats.
 *
 * Each such entry carries that game's totals under the same stat ids as the
 * averages. The debug run against the real league confirmed 15 of them come
 * back with totals and no averages. What it did not show is how they are
 * ordered, so they are sorted by scoring period when every one has one, and
 * left in ESPN's order when not.
 */
export function gameLog(stats) {
  const logs = (Array.isArray(stats) ? stats : []).filter(
    (x) => !SPLIT_PREFIXES.has(String(x.id).slice(0, 2)) && typeof x.stats?.[STAT_ID.pts] === 'number'
  );
  const games = logs.map((x) => {
    const g = { season: x.seasonId ?? null, period: typeof x.scoringPeriodId === 'number' ? x.scoringPeriodId : null };
    for (const [key, id] of Object.entries(STAT_ID)) {
      if (key !== 'gp') g[key] = typeof x.stats[id] === 'number' ? x.stats[id] : null;
    }
    return g;
  });
  if (games.every((g) => g.period !== null)) games.sort((a, b) => a.period - b.period);
  return games.slice(-MAX_GAMES);
}

/**
 * Player cards from ESPN's kona_playercard view, keyed by player id.
 *
 * Splits are matched by ESPN's id scheme: two digits for the split (00 season
 * total, 01 last 7, 02 last 15, 03 last 30) then the season. `prior` is last
 * season's total, so a card still shows something before opening night.
 *
 * Ownership and rank are read defensively: they are in the card as far as the
 * data I could check shows, but the espn-api library never reads them, so they
 * are the likeliest fields to be named differently. A missing one is left out
 * of the card rather than failing it.
 */
export function parsePlayerCards(json, season) {
  if (!Array.isArray(json?.players)) throw new Error('Malformed payload: missing players');
  const out = new Map();
  for (const entry of json.players) {
    const p = entry.player ?? entry.playerPoolEntry?.player ?? entry;
    const id = p.id ?? entry.id;
    if (id === undefined || !p.fullName) continue;
    const split = (code, year) => statLine((p.stats ?? []).find((x) => x.id === `${code}${year}`));
    out.set(id, {
      id,
      name: p.fullName,
      jersey: p.jersey ?? null,
      games: gameLog(p.stats),
      position: POSITIONS[(p.defaultPositionId ?? 0) - 1] ?? '',
      proTeam: PRO_TEAMS[p.proTeamId] ?? '',
      injury: INJURY[p.injuryStatus] ?? (p.injuryStatus ? String(p.injuryStatus).replace(/_/g, ' ').toLowerCase() : 'Healthy'),
      owned: typeof p.ownership?.percentOwned === 'number' ? p.ownership.percentOwned : null,
      rank: p.draftRanksByRankType?.STANDARD?.rank ?? p.ratings?.['0']?.totalRanking ?? null,
      stats: {
        season: split('00', season),
        last7: split('01', season),
        last15: split('02', season),
        last30: split('03', season),
        // ESPN's own projection for this season, per game. It is what there is
        // to show before the first game, and a better stand-in than last season.
        projected: split('10', season),
        prior: split('00', season - 1),
      },
    });
  }
  return out;
}

// Season averages move slowly, and a trade card opens several players at once,
// so the same set is asked for at most every five minutes.
let cardCache = { key: '', at: 0, value: null };

export function clearCardCache() {
  cardCache = { key: '', at: 0, value: null };
}

export async function fetchPlayerCards(cfg, ids, { ttlMs = 300_000, now = Date.now(), games = 1, ...deps } = {}) {
  if (ids.length === 0) return new Map();
  const key = `${cfg.leagueId}:${cfg.season}:${games}:${[...ids].sort((a, b) => a - b).join(',')}`;
  if (ttlMs > 0 && cardCache.key === key && now - cardCache.at < ttlMs) return cardCache.value;
  const year = cfg.season;
  const json = await get(cfg, {
    views: ['kona_playercard'],
    filter: {
      players: {
        filterIds: { value: ids },
        // The first number is how many recent scoring periods to include
        // game-by-game: 1 for the trade panel, which has no use for them, and
        // more when a chart is going to be drawn. The ids are the splits a
        // card does need: season total, projected, last 7/15/30, and last
        // season's total.
        filterStatsForTopScoringPeriodIds: {
          value: games,
          additionalValue: [`00${year}`, `10${year}`, `01${year}`, `02${year}`, `03${year}`, `00${year - 1}`],
        },
      },
    },
    unwrap: true,
    ...deps,
  });
  const value = parsePlayerCards(json, year);
  if (ttlMs > 0) cardCache = { key, at: now, value };
  return value;
}

/**
 * The players worth drafting, best first by ESPN's average draft position.
 *
 * Asks for the most-owned players (the same search view /player uses, whose
 * answers are confirmed against the real league) and orders them by ADP here
 * rather than trusting ESPN to sort by it, since the sort option for ADP is
 * not one I have seen answer. A player with no ADP falls back to his ESPN
 * rank, then to the end of the list, so nobody worth drafting is dropped for
 * missing a number.
 */
export async function fetchDraftPool(cfg, { limit = 250, ...deps } = {}) {
  const json = await get(cfg, {
    views: ['kona_player_info'],
    filter: {
      players: {
        filterStatus: { value: ['FREEAGENT', 'WAIVERS', 'ONTEAM'] },
        limit,
        sortPercOwned: { sortPriority: 1, sortAsc: false },
      },
    },
    unwrap: true,
    ...deps,
  });
  if (!Array.isArray(json?.players)) throw new Error('Malformed payload: missing players');
  const seen = new Set();
  return json.players
    .map((e) => e.player ?? e)
    .filter((p) => p.id !== undefined && p.fullName && !seen.has(p.id) && seen.add(p.id))
    .map((p) => {
      const adp = p.ownership?.averageDraftPosition;
      const rank = p.draftRanksByRankType?.STANDARD?.rank;
      return {
        id: p.id,
        name: p.fullName,
        position: POSITIONS[(p.defaultPositionId ?? 0) - 1] ?? '',
        proTeam: PRO_TEAMS[p.proTeamId] ?? '',
        adp: typeof adp === 'number' && adp > 0 ? adp : typeof rank === 'number' && rank > 0 ? rank : 9999,
      };
    })
    .sort((a, b) => a.adp - b.adp || a.id - b.id);
}

// Autocomplete asks on every keystroke, and the same few prefixes repeat, so
// recent searches are kept for a minute.
let searchCache = new Map();

export function clearSearchCache() {
  searchCache = new Map();
}

/**
 * Players matching a name, whether or not anyone has drafted them.
 *
 * ESPN's own player search (the view its web pages use), most-owned first, so
 * "jok" finds the star before the journeyman. Confirmed against the real
 * league: a search for "Jokic" returned him, rostered or not.
 */
export async function searchPlayers(cfg, term, { ttlMs = 60_000, now = Date.now(), limit = 15, ...deps } = {}) {
  const key = `${cfg.leagueId}:${cfg.season}:${String(term).toLowerCase()}`;
  const hit = searchCache.get(key);
  if (ttlMs > 0 && hit && now - hit.at < ttlMs) return hit.value;
  const json = await get(cfg, {
    views: ['kona_player_info'],
    filter: {
      players: {
        filterName: { value: String(term) },
        filterStatus: { value: ['FREEAGENT', 'WAIVERS', 'ONTEAM'] },
        limit,
        sortPercOwned: { sortPriority: 1, sortAsc: false },
      },
    },
    unwrap: true,
    ...deps,
  });
  if (!Array.isArray(json?.players)) throw new Error('Malformed payload: missing players');
  const value = json.players
    .map((e) => e.player ?? e)
    .filter((p) => p.id !== undefined && p.fullName)
    .map((p) => ({
      id: p.id,
      name: p.fullName,
      position: POSITIONS[(p.defaultPositionId ?? 0) - 1] ?? '',
      proTeam: PRO_TEAMS[p.proTeamId] ?? '',
    }));
  if (ttlMs > 0) {
    if (searchCache.size > 200) searchCache = new Map();
    searchCache.set(key, { at: now, value });
  }
  return value;
}

/**
 * Height, weight, age and college from ESPN's public athlete page.
 *
 * Best effort and never fatal: it is a different host from the fantasy API,
 * it assumes the fantasy player id is also the athlete id, and any of that can
 * be wrong. A card without a bio line is still a good card.
 */
export async function fetchBio(id, { fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(
      `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${id}`,
      { headers: { 'User-Agent': 'og-server', Accept: 'application/json' } }
    );
    if (!res.ok) return null;
    const a = (await res.json())?.athlete;
    if (!a) return null;
    const bio = {
      height: a.displayHeight ?? null,
      weight: a.displayWeight ?? null,
      age: typeof a.age === 'number' ? a.age : null,
      college: a.college?.name ?? null,
      experience: typeof a.experience?.years === 'number' ? a.experience.years : null,
    };
    return Object.values(bio).some((v) => v !== null) ? bio : null;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------- diagnostics

const keysOf = (o) => (o && typeof o === 'object' ? Object.keys(o) : []);
const short = (list, max = 8) => (list.length > max ? `${list.slice(0, max).join(', ')}, +${list.length - max} more` : list.join(', '));

/**
 * Ask ESPN for the shapes this bot is built on, and report what is really
 * there. Each part fails on its own: when a guess about ESPN is wrong the
 * point is to see which one, not to stop at the first.
 *
 * It reports field names, counts and the scoring format, never values that
 * belong to an account: no cookies, no tokens, no owner details.
 */
export async function diagnose(cfg, playerId, { fetchImpl = fetch, ...deps } = {}) {
  const facts = { errors: [] };
  const run = async (name, fn) => {
    try { facts[name] = await fn(); } catch (err) { facts.errors.push(`${name}: ${err.message}`); }
  };

  await run('league', async () => {
    const j = await get(cfg, { views: ['mSettings', 'mTeam'], unwrap: true, fetchImpl, ...deps });
    const scoring = j.settings?.scoringSettings;
    const trade = j.settings?.tradeSettings;
    return {
      scoringType: scoring?.scoringType ?? null,
      teams: Array.isArray(j.teams) ? j.teams.length : null,
      scoringPeriodId: j.scoringPeriodId ?? null,
      finalScoringPeriod: j.status?.finalScoringPeriod ?? null,
      matchupPeriod: j.status?.currentMatchupPeriod ?? null,
      categories: Array.isArray(scoring?.scoringItems) ? scoring.scoringItems.map((i) => i.statId) : null,
      reversed: Array.isArray(scoring?.scoringItems) ? scoring.scoringItems.filter((i) => i.isReverseItem).map((i) => i.statId) : null,
      tradeKeys: keysOf(trade),
      deadline: typeof trade?.deadlineDate === 'number' && trade.deadlineDate > 0 ? trade.deadlineDate : null,
    };
  });

  await run('card', async () => {
    const year = cfg.season;
    const j = await get(cfg, {
      views: ['kona_playercard'],
      filter: {
        players: {
          filterIds: { value: [playerId] },
          // Deliberately generous: game-by-game for the last 15 periods, every
          // split, and four earlier seasons, to see which of them come back.
          filterStatsForTopScoringPeriodIds: {
            value: 15,
            additionalValue: [
              `00${year}`, `10${year}`, `01${year}`, `02${year}`, `03${year}`,
              ...[1, 2, 3, 4].map((n) => `00${year - n}`),
            ],
          },
        },
      },
      unwrap: true, fetchImpl, ...deps,
    });
    const entry = j.players?.[0];
    const p = entry?.player ?? entry?.playerPoolEntry?.player ?? entry;
    if (!p) throw new Error('no player came back');
    const stats = Array.isArray(p.stats) ? p.stats : [];
    const splits = stats.filter((x) => SPLIT_PREFIXES.has(String(x.id).slice(0, 2)));
    const logs = stats.filter((x) => !SPLIT_PREFIXES.has(String(x.id).slice(0, 2)));
    return {
      name: p.fullName ?? null,
      entryKeys: keysOf(entry),
      playerKeys: keysOf(p),
      ownershipKeys: keysOf(p.ownership),
      percentOwned: typeof p.ownership?.percentOwned === 'number' ? p.ownership.percentOwned : null,
      rankKeys: keysOf(p.draftRanksByRankType),
      ratingKeys: keysOf(p.ratings),
      splits: splits.map((x) => `${x.id}${x.averageStats ? '*' : ''}`),
      seasons: [...new Set(stats.map((x) => x.seasonId).filter((v) => v !== undefined))],
      logCount: logs.length,
      logIds: logs.slice(0, 3).map((x) => String(x.id)),
      logsHaveAverages: logs.length ? logs.some((x) => x.averageStats) : null,
      logsHaveStats: logs.length ? logs.some((x) => x.stats && keysOf(x.stats).length) : null,
    };
  });

  // Whether ESPN's own player search answers, which is what finding a player
  // nobody has drafted yet (draft night, the waiver wire) would be built on.
  // Run after the card so it can search for the same player by surname.
  await run('search', async () => {
    const term = String(facts.card?.name ?? 'jokic').split(' ').slice(-1)[0];
    const j = await get(cfg, {
      views: ['kona_player_info'],
      filter: {
        players: {
          filterName: { value: term },
          filterStatus: { value: ['FREEAGENT', 'WAIVERS', 'ONTEAM'] },
          limit: 5,
          sortPercOwned: { sortPriority: 1, sortAsc: false },
        },
      },
      unwrap: true, fetchImpl, ...deps,
    });
    const list = Array.isArray(j.players) ? j.players : [];
    const names = list.map((e) => (e.player ?? e).fullName).filter(Boolean);
    return {
      term,
      count: list.length,
      names: names.slice(0, 3),
      matched: names.some((n) => n.toLowerCase().includes(term.toLowerCase())),
    };
  });

  // Whether the draft pool comes back, and how many of those have a real ADP.
  await run('pool', async () => {
    const pool = await fetchDraftPool(cfg, { fetchImpl, ...deps });
    return { count: pool.length, withAdp: pool.filter((p) => p.adp < 9999).length, first: pool[0]?.name ?? null };
  });

  await run('bio', async () => {
    const res = await fetchImpl(
      `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${playerId}`,
      { headers: { 'User-Agent': 'og-server', Accept: 'application/json' } }
    );
    if (!res.ok) return { status: res.status, fields: [] };
    const a = (await res.json())?.athlete ?? {};
    const want = ['displayHeight', 'displayWeight', 'age', 'college', 'experience'];
    return { status: res.status, fields: want.filter((k) => a[k] !== undefined && a[k] !== null) };
  });

  return facts;
}

/** The diagnostic as a message a mod can paste back. */
export function diagnosticMessage(facts) {
  const out = [];
  const L = facts.league;
  if (L) {
    out.push(
      '**League**',
      '```',
      `scoring: ${L.scoringType ?? '?'} · ${L.teams ?? '?'} teams`,
      `scoring period ${L.scoringPeriodId ?? '?'} of ${L.finalScoringPeriod ?? '?'} · matchup period ${L.matchupPeriod ?? '?'}`,
      `categories: ${L.categories ? short(L.categories, 14) : '?'}${L.reversed?.length ? ` (lower is better: ${L.reversed.join(', ')})` : ''}`,
      `trade deadline: ${L.deadline ? new Date(L.deadline).toISOString().slice(0, 10) : 'none found'} · tradeSettings: ${L.tradeKeys.length ? short(L.tradeKeys, 6) : 'absent'}`,
      '```'
    );
  }
  const C = facts.card;
  if (C) {
    out.push(
      `**Player card: ${C.name ?? '?'}**`,
      '```',
      `player fields: ${short(C.playerKeys, 12)}`,
      `ownership: ${C.percentOwned ?? 'no percentOwned'} (${C.ownershipKeys.length ? short(C.ownershipKeys, 5) : 'no block'})`,
      `ranks: ${C.rankKeys.length ? short(C.rankKeys, 4) : 'no draftRanks'} · ratings: ${C.ratingKeys.length ? short(C.ratingKeys, 4) : 'none'}`,
      `splits (* = per-game): ${C.splits.length ? short(C.splits, 10) : 'none'}`,
      `seasons present: ${C.seasons.length ? C.seasons.join(', ') : 'none'}`,
      `game logs: ${C.logCount}${C.logCount ? ` (e.g. ${C.logIds.join(', ')}) per-game: ${C.logsHaveAverages ? 'yes' : 'no'}, totals: ${C.logsHaveStats ? 'yes' : 'no'}` : ''}`,
      '```'
    );
  }
  const S = facts.search;
  if (S) {
    out.push(
      `**Name search:** "${S.term}" gave ${S.count} result${S.count === 1 ? '' : 's'}` +
        (S.names.length ? ` (${S.names.join(', ')})` : '') +
        (S.count && !S.matched ? ', but none matched' : '')
    );
  }
  const PL = facts.pool;
  if (PL) {
    out.push(`**Draft pool:** ${PL.count} players, ${PL.withAdp} with an ADP${PL.first ? `, best is ${PL.first}` : ''}`);
  }
  const B = facts.bio;
  if (B) out.push(`**Bio page:** HTTP ${B.status} · has ${B.fields.length ? B.fields.join(', ') : 'nothing usable'}`);
  if (facts.errors.length) out.push('**Failed:**', '```', ...facts.errors.map((e) => e.slice(0, 160)), '```');
  const text = out.join('\n');
  return text.length <= 2000 ? text : `${text.slice(0, 1990)}\n…`;
}

// ---------------------------------------------------------------- formatting

const record = (t) => `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}`;

export function standingsMessage(table) {
  if (table.length === 0) return 'No teams in the league yet.';
  const lines = table.map((t, i) => `${i + 1}. **${t.name}** (${record(t)})`);
  return `**NBA fantasy standings**\n${lines.join('\n')}`;
}

export function scoresMessage({ period, matchups }) {
  if (matchups.length === 0) return `No matchups found for week ${period}.`;
  const score = (s) => (s.tally ? `${s.tally.wins}-${s.tally.losses}${s.tally.ties ? `-${s.tally.ties}` : ''}` : String(s.points));
  const lines = matchups.map((m) => `**${m.home.name}** ${score(m.home)} — ${score(m.away)} **${m.away.name}**`);
  return `**Week ${period} matchups**\n${lines.join('\n')}`;
}

export function activityLine(a) {
  return `📣 **${a.team}** ${a.kind}: ${a.player}`;
}

export function activityMessage(items) {
  if (items.length === 0) return 'No recent moves.';
  return `**Recent league moves**\n${items.map(activityLine).join('\n')}`;
}
