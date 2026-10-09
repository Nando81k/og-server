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
