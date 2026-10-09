/**
 * The ESPN fantasy feature: parsing, the HTTP calls, /fantasy, and the feed.
 *
 * Fixtures are hand-built in the shape ESPN returns (taken from the fields the
 * espn-api library reads), because the real league is private and cannot be
 * called from a test. They prove this code handles that shape; they cannot
 * prove ESPN still sends it. The first real run against the league is the
 * test that does.
 */

import {
  fantasyConfig, leagueUrl, teamName, parseStandings, parseMatchups, parseActivity,
  fetchLeague, fetchActivity, fetchPlayerNames,
  standingsMessage, scoresMessage, activityLine, activityMessage, ACTIVITY_KINDS,
} from './fantasy.mjs';
import worker, { handleFantasy, runFantasyFeed, FANTASY_CRON } from './index.mjs';
import { COMMANDS } from '../../shared/commands.mjs';
import { readFileSync } from 'node:fs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };
const throws = async (fn) => { try { await fn(); return false; } catch { return true; } };

const league = {
  seasonId: 2027,
  status: { currentMatchupPeriod: 2 },
  teams: [
    { id: 1, name: 'Bucket Getters', playoffSeed: 2, record: { overall: { wins: 3, losses: 1, ties: 0 } } },
    { id: 2, location: 'Brooklyn', nickname: 'Nets Fans', playoffSeed: 1, record: { overall: { wins: 4, losses: 0, ties: 0 } } },
    { id: 3, name: 'Zero Seed', playoffSeed: 0, record: { overall: { wins: 0, losses: 0, ties: 0 } } },
  ],
  schedule: [
    { matchupPeriodId: 1, home: { teamId: 1, totalPoints: 5 }, away: { teamId: 2, totalPoints: 4 } },
    { matchupPeriodId: 2,
      home: { teamId: 1, totalPoints: 0, cumulativeScore: { wins: 6, losses: 3, ties: 0 } },
      away: { teamId: 2, totalPoints: 0, cumulativeScore: { wins: 3, losses: 6, ties: 0 } } },
    { matchupPeriodId: 2, home: { teamId: 3, totalPoints: 812.5 } }, // bye: no away side
  ],
};

console.log('--- config ---');
check('no league id means the feature is off', fantasyConfig({}) === null);
check('empty league id means the feature is off', fantasyConfig({ FANTASY_LEAGUE_ID: '' }) === null);
const env0 = { FANTASY_LEAGUE_ID: '123', FANTASY_SEASON: '2027', ESPN_S2: 's2', ESPN_SWID: '{abc}' };
const cfg = fantasyConfig(env0);
check('reads league, season and cookies', cfg.leagueId === '123' && cfg.season === 2027 && cfg.espnS2 === 's2' && cfg.swid === '{abc}');
check('a public league needs no cookies', fantasyConfig({ FANTASY_LEAGUE_ID: '1', FANTASY_SEASON: '2027' }).espnS2 === '');
check('league url targets basketball (fba) and the season',
  leagueUrl(cfg) === 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/2027/segments/0/leagues/123');

console.log('\n--- team names ---');
check('uses name when present', teamName(league.teams[0]) === 'Bucket Getters');
check('falls back to location + nickname', teamName(league.teams[1]) === 'Brooklyn Nets Fans');
check('falls back to the id as a last resort', teamName({ id: 9 }) === 'Team 9');

console.log('\n--- standings ---');
const table = parseStandings(league);
check('sorted by seed, unseeded last', table.map((t) => t.id).join() === '2,1,3');
check('carries the record', table[0].wins === 4 && table[1].losses === 1);
check('rejects a payload with no teams', await throws(() => parseStandings({})));
check('rejects a team with no record', await throws(() => parseStandings({ teams: [{ id: 1 }] })));
const sm = standingsMessage(table);
check('renders rank, name and record', sm.includes('1. **Brooklyn Nets Fans** (4-0)') && sm.includes('2. **Bucket Getters** (3-1)'));
check('ties only show when there are some',
  standingsMessage([{ name: 'A', wins: 1, losses: 1, ties: 1 }]).includes('(1-1-1)'));
check('an empty league says so', standingsMessage([]).includes('No teams'));

console.log('\n--- matchups ---');
const m = parseMatchups(league);
check('defaults to the current matchup period', m.period === 2);
check('skips other periods and byes', m.matchups.length === 1);
check('resolves team names', m.matchups[0].home.name === 'Bucket Getters' && m.matchups[0].away.name === 'Brooklyn Nets Fans');
check('category leagues carry a tally', m.matchups[0].home.tally.wins === 6);
check('a specific period can be asked for', parseMatchups(league, 1).matchups.length === 1);
check('rejects a payload with no schedule', await throws(() => parseMatchups({})));
const sc = scoresMessage(m);
check('shows category tallies', sc.includes('**Bucket Getters** 6-3 — 3-6 **Brooklyn Nets Fans**'));
const pts = parseMatchups({ ...league, schedule: [{ matchupPeriodId: 1, home: { teamId: 1, totalPoints: 101.5 }, away: { teamId: 2, totalPoints: 99 } }] }, 1);
check('points leagues show points', scoresMessage(pts).includes('101.5 — 99'));
check('no matchups says so', scoresMessage({ period: 4, matchups: [] }).includes('week 4'));

console.log('\n--- activity ---');
const teams = new Map([[1, 'Bucket Getters'], [2, 'Nets Fans']]);
const players = new Map([[100, 'Jalen Brunson'], [200, 'Mikal Bridges']]);
const feed = {
  topics: [
    { date: 2000, messages: [
      { messageTypeId: 178, to: 1, targetId: 100 },
      { messageTypeId: 188, to: 1, targetId: 100 }, // lineup move: ignored
    ] },
    { date: 1000, messages: [
      { messageTypeId: 239, for: 2, targetId: 200 },
      { messageTypeId: 244, from: 2, to: 1, targetId: 200 },
    ] },
  ],
};
const acts = parseActivity(feed, { teams, players });
check('keeps adds, drops and trades, drops lineup moves', acts.length === 3);
check('add: team from "to"', acts[0].team === 'Bucket Getters' && acts[0].kind === ACTIVITY_KINDS[178]);
check('drop: team from "for"', acts[1].team === 'Nets Fans' && acts[1].kind === 'dropped');
check('trade: team from "from"', acts[2].team === 'Nets Fans' && acts[2].kind === 'traded');
check('resolves player names', acts[0].player === 'Jalen Brunson');
check('unknown ids degrade rather than throw',
  parseActivity({ topics: [{ date: 1, messages: [{ messageTypeId: 178, to: 9, targetId: 9 }] }] }, { teams, players })[0].player === 'Player 9');
check('keys are unique per move', new Set(acts.map((a) => a.key)).size === 3);
check('keys are stable across parses', parseActivity(feed, { teams, players })[0].key === acts[0].key);
check('rejects a payload with no topics', await throws(() => parseActivity({}, { teams, players })));
check('a line names team, move and player', activityLine(acts[0]) === '📣 **Bucket Getters** added (free agent): Jalen Brunson');
check('no moves says so', activityMessage([]).includes('No recent moves'));

console.log('\n--- HTTP ---');
const calls = [];
const fakeFetch = (routes) => async (url, init) => {
  calls.push({ url, headers: init.headers });
  const hit = Object.entries(routes).find(([k]) => url.includes(k));
  if (!hit) return { ok: false, status: 404, json: async () => ({}) };
  const [, r] = hit;
  return typeof r === 'number' ? { ok: false, status: r, json: async () => ({}) } : { ok: true, status: 200, json: async () => r };
};
await fetchLeague(cfg, { fetchImpl: fakeFetch({ '/leagues/123': league }) });
check('asks for team, matchup and settings views',
  ['mTeam', 'mMatchup', 'mSettings'].every((v) => calls[0].url.includes(`view=${v}`)));
check('sends both cookies when it has them', calls[0].headers.Cookie === 'espn_s2=s2; SWID={abc}');
calls.length = 0;
await fetchLeague({ ...cfg, espnS2: '', swid: '' }, { fetchImpl: fakeFetch({ '/leagues/123': league }) });
check('sends no cookie header for a public league', calls[0].headers.Cookie === undefined);
check('unwraps a one-element array',
  (await fetchLeague(cfg, { fetchImpl: fakeFetch({ '/leagues/123': [league] }) })).seasonId === 2027);
let msg = '';
try { await fetchLeague(cfg, { fetchImpl: fakeFetch({ '/leagues/123': 401 }) }); } catch (e) { msg = e.message; }
check('401 explains the cookies', msg.includes('ESPN_S2') && msg.includes('ESPN_SWID'));
msg = '';
try { await fetchLeague(cfg, { fetchImpl: fakeFetch({ '/leagues/123': 404 }) }); } catch (e) { msg = e.message; }
check('404 points at the league id', msg.includes('FANTASY_LEAGUE_ID'));
check('other failures carry the status', await (async () => {
  try { await fetchLeague(cfg, { fetchImpl: fakeFetch({ '/leagues/123': 503 }) }); } catch (e) { return e.message === 'ESPN 503'; }
  return false;
})());
check('no ids means no request', (await fetchPlayerNames(cfg, [])).size === 0);
calls.length = 0;
const names = await fetchPlayerNames(cfg, [100], { fetchImpl: fakeFetch({ '/players': [{ id: 100, fullName: 'Jalen Brunson' }] }) });
check('asks for players by id, not the whole pool',
  JSON.parse(calls[0].headers['x-fantasy-filter']).players.filterIds.value[0] === 100);
check('maps ids to names', names.get(100) === 'Jalen Brunson');
calls.length = 0;
const full = await fetchActivity(cfg, {
  fetchImpl: fakeFetch({
    '/communication/': feed,
    '/players': [{ id: 100, fullName: 'Jalen Brunson' }, { id: 200, fullName: 'Mikal Bridges' }],
    '/leagues/123': { ...league, teams: [{ ...league.teams[0] }, { id: 2, name: 'Nets Fans', record: { overall: {} } }] },
  }),
});
check('fetchActivity joins feed, teams and players', full.length === 3 && full[0].team === 'Bucket Getters' && full[0].player === 'Jalen Brunson');
const filter = JSON.parse(calls.find((c) => c.url.includes('/communication/')).headers['x-fantasy-filter']);
check('feed is filtered to transactions, newest first',
  filter.topics.filterType.value[0] === 'ACTIVITY_TRANSACTIONS' && filter.topics.sortMessageDate.sortAsc === false);
check('lineup moves (188) are never requested', !filter.topics.filterIncludeMessageTypeIds.value.includes(188));

console.log('\n--- /fantasy ---');
const cmd = (sub) => ({ data: { name: 'fantasy', options: [{ name: sub, type: 1 }] } });
const stubs = { fetchLeague: async () => league, fetchActivity: async () => acts };
let out = await handleFantasy(cmd('standings'), env0, stubs);
check('standings replies publicly with the table', out.content.includes('Brooklyn Nets Fans') && !out.flags);
out = await handleFantasy(cmd('scores'), env0, stubs);
check('scores replies with the matchups', out.content.includes('Week 2'));
out = await handleFantasy(cmd('recent'), env0, stubs);
check('recent replies with the moves', out.content.includes('Jalen Brunson'));
check('nobody gets pinged by the reply', out.allowed_mentions.parse.length === 0);
out = await handleFantasy(cmd('standings'), {}, stubs);
check('before setup, says so privately', out.flags === 64 && out.content.includes('not been connected'));
out = await handleFantasy(cmd('standings'), env0, { fetchLeague: async () => { throw new Error('ESPN 503'); } });
check('an ESPN failure is private, not a crash', out.flags === 64 && out.content.includes('ESPN 503'));
out = await handleFantasy(cmd('nonsense'), env0, stubs);
check('an unknown subcommand is refused', out.flags === 64);
const long = Array.from({ length: 80 }, (_, i) => ({ id: i, name: 'x'.repeat(40), wins: 1, losses: 1, ties: 0, seed: i + 1 }));
out = await handleFantasy(cmd('standings'), env0, { fetchLeague: async () => ({
  teams: long.map((t) => ({ id: t.id, name: t.name, playoffSeed: t.seed, record: { overall: { wins: 1, losses: 1, ties: 0 } } })),
}) });
check('replies are cut to Discord\'s 2000 character limit', out.content.length <= 2000);

console.log('\n--- the command definition ---');
const def = COMMANDS.find((c) => c.name === 'fantasy');
check('/fantasy is registered', Boolean(def));
check('it offers standings, scores and recent', def.options.map((o) => o.name).join() === 'standings,scores,recent');
check('every option is a subcommand', def.options.every((o) => o.type === 1));
check('it is not gated: nothing here writes', def.default_member_permissions === undefined);

console.log('\n--- the feed ---');
const marks = new Set();
const posted = [];
const api = { postMessage: async (ch, content) => posted.push({ ch, content }) };
const feedEnv = { ...env0, FANTASY_CHANNEL_ID: '555', DB: {} };
const feedDeps = (items) => ({
  fetchActivity: async () => items,
  alreadyDone: async (_db, k) => marks.has(k),
  markDone: async (_db, k) => { marks.add(k); },
});
check('off until the league is set', (await runFantasyFeed({ DB: {} }, api, feedDeps(acts))).posted === 0 && posted.length === 0);
check('off until a channel is set',
  (await runFantasyFeed({ ...env0, DB: {} }, api, feedDeps(acts))).posted === 0 && posted.length === 0);

let res = await runFantasyFeed(feedEnv, api, feedDeps(acts));
check('first run seeds without posting', res.seeded === true && posted.length === 0);
check('seeding marks every existing move', acts.every((a) => marks.has(`fantasy:123:${a.key}`)));
res = await runFantasyFeed(feedEnv, api, feedDeps(acts));
check('a second run with nothing new posts nothing', res.posted === 0 && posted.length === 0);

const newer = { key: '3000|178|300|1', date: 3000, team: 'Bucket Getters', kind: 'added (free agent)', playerId: 300, player: 'OG Anunoby' };
const newest = { key: '4000|179|400|2', date: 4000, team: 'Nets Fans', kind: 'dropped', playerId: 400, player: 'Cam Thomas' };
res = await runFantasyFeed(feedEnv, api, feedDeps([newest, newer, ...acts]));
check('posts only the new moves', res.posted === 2 && posted.length === 2);
check('to the configured channel', posted.every((p) => p.ch === '555'));
check('oldest first, so the channel reads in order',
  posted[0].content.includes('OG Anunoby') && posted[1].content.includes('Cam Thomas'));
res = await runFantasyFeed(feedEnv, api, feedDeps([newest, newer, ...acts]));
check('and never posts them twice', res.posted === 0 && posted.length === 2);

marks.clear(); posted.length = 0;
await runFantasyFeed(feedEnv, api, feedDeps([]));
const backlog = Array.from({ length: 14 }, (_, i) => ({ ...newer, key: `k${i}`, player: `P${i}` }));
res = await runFantasyFeed(feedEnv, api, feedDeps(backlog));
check('a backlog is capped per run', res.posted === 10 && posted.length === 10);
res = await runFantasyFeed(feedEnv, api, feedDeps(backlog));
check('and the rest go out next run', res.posted === 4 && posted.length === 14);

marks.clear(); posted.length = 0;
await runFantasyFeed(feedEnv, api, feedDeps([]));
const failing = { postMessage: async () => { throw new Error('discord down'); } };
check('a failed post is thrown, not swallowed', await throws(() => runFantasyFeed(feedEnv, failing, feedDeps([newer]))));
check('and the move stays unmarked so it retries', !marks.has('fantasy:123:' + newer.key));
res = await runFantasyFeed(feedEnv, api, feedDeps([newer]));
check('the retry posts it', res.posted === 1);

console.log('\n--- cron routing ---');
// The 10-minute trigger must reach only the feed. Reaching runCron would run
// the promotion pass and the pick'em every ten minutes, against a bare env
// with no database: it would throw, and that is how this check fails.
const realFetch = globalThis.fetch;
let outbound = 0;
globalThis.fetch = async () => { outbound += 1; throw new Error('no network in tests'); };
let routed = true;
try { await worker.scheduled({ cron: FANTASY_CRON }, { DISCORD_TOKEN: 't' }); } catch { routed = false; }
globalThis.fetch = realFetch;
check('the fantasy cron runs only the feed (a no-op when unconfigured)', routed && outbound === 0);

console.log('\n--- wrangler.toml and the cron string ---');
const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
check('both triggers are scheduled', toml.includes('crons = ["0 9 * * *", "*/10 * * * *"]'));
check('FANTASY_CRON matches the string in wrangler.toml', toml.includes(`"${FANTASY_CRON}"`));
check('no ESPN cookie ever appears in the config', !/espn_s2\s*=|swid\s*=/i.test(toml.replace(/#.*$/gm, '')));

if (fails.length) { console.log(`\n${fails.length} FAILED`); process.exit(1); }
console.log('\nall fantasy checks passed');
