/**
 * Player cards and the trade Explore panel.
 *
 * Fixtures are hand-built in the shape the espn-api library reads from ESPN's
 * kona_playercard view, because the league is private and cannot be called
 * from a test. They prove this code handles that shape; they cannot prove ESPN
 * still sends it, or that the extra fields (ownership, rank) are named as
 * assumed. The first real /player is the test that does.
 */

import {
  parsePlayerCards, fetchPlayerCards, clearCardCache, fetchBio,
  parseRosters, categoriesFrom, CATEGORIES, searchPlayers, clearSearchCache, gameLog,
} from './fantasy.mjs';
import {
  show, bestLine, totals, netFor, sideTable, netBlock, tidy,
  statsTable, playerEmbed, statusColor, headshotUrl, chartData, grid, compareEmbed,
} from './player.mjs';
import { areaChartUrl, compareChartUrl, QUICKCHART, MAX_URL, SERIES_COLORS } from './chart.mjs';
import {
  exploreMessage, exploreComponents, parseExploreId, voteComponents,
} from './trade.mjs';
import {
  handlePlayer, handlePlayerAutocomplete, handleTradeExplore, handleTradeVote, handleTrade, handleFantasy, handleCompare,
} from './index.mjs';
import { COMMANDS } from '../../shared/commands.mjs';
import { memoryDb, stubApi, who, cmd } from './test-db.mjs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };
const throws = async (fn) => { try { await fn(); return false; } catch { return true; } };

// ----------------------------------------------------------------- fixtures
const avg = (pts, reb, ast, stl, blk, tpm, fg, ft, to, min, gp) => ({
  '0': pts, '6': reb, '3': ast, '2': stl, '1': blk, '17': tpm, '19': fg, '20': ft, '11': to, '40': min, '42': gp,
});
const splitOf = (id, a) => ({ seasonId: 2027, id, scoringPeriodId: 0, averageStats: a, stats: { '42': a['42'] } });

const gameRow = (id, season, period, pts, reb = 8, ast = 2) => ({
  id, seasonId: season, scoringPeriodId: period,
  stats: { '0': pts, '6': reb, '3': ast, '2': 1, '1': 0, '17': 2, '11': 3, '40': 30 },
});
const valePts = [14, 22, 19, 17, 24, 12, 20, 18, 26, 15, 21, 19, 23, 16, 22];

const raw = (id, name, extra) => ({
  id,
  player: { id, fullName: name, defaultPositionId: 5, proTeamId: 13, injuryStatus: 'ACTIVE', stats: [], ...extra },
});
const payload = {
  players: [
    raw(100, 'Marcus Vale', {
      jersey: '13',
      ownership: { percentOwned: 97.2 },
      draftRanksByRankType: { STANDARD: { rank: 34 } },
      stats: [
        splitOf('002027', avg(18.4, 10.2, 2.1, 0.8, 1.9, 0.4, 0.571, 0.684, 2.0, 31.2, 61)),
        splitOf('022027', avg(19.2, 10.6, 2.0, 0.9, 2.1, 0.3, 0.580, 0.672, 2.1, 31.8, 15)),
        splitOf('012027', avg(21.0, 11.3, 1.7, 0.9, 2.4, 0.2, 0.592, 0.650, 2.3, 32.0, 7)),
        splitOf('032027', avg(18.9, 10.4, 2.0, 0.8, 2.0, 0.3, 0.575, 0.680, 2.1, 31.5, 30)),
        splitOf('002026', avg(17.5, 9.6, 2.0, 0.7, 1.7, 0.3, 0.560, 0.690, 1.9, 30.1, 70)),
        ...valePts.map((pts, i) => gameRow(`05401811${String(i).padStart(3, '0')}`, 2027, 100 + i, pts)),
      ],
    }),
    // Has not played this season: only last season's line exists.
    raw(101, 'Jules Okafor', {
      defaultPositionId: 3,
      stats: [
        splitOf('002026', avg(11.0, 4.8, 2.0, 1.0, 0.4, 1.2, 0.462, 0.811, 1.1, 27.4, 58)),
        ...[8, 12, 10, 14, 9].map((pts, i) => gameRow(`05400000${i}`, 2026, 50 + i, pts)),
      ],
    }),
    raw(200, 'Theo Brandt', {
      defaultPositionId: 1, proTeamId: 18, injuryStatus: 'DAY_TO_DAY',
      stats: [splitOf('002027', avg(21.3, 4.0, 7.9, 1.5, 0.3, 2.2, 0.455, 0.872, 3.6, 34.0, 64))],
    }),
    // A split that exists but has no games in it must not read as zeros.
    raw(201, 'Dario Reyes', { stats: [splitOf('002027', avg(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0))] }),
    // Nothing yet this season, but ESPN has projected him.
    raw(150, 'Pat Proj', {
      stats: [
        splitOf('102027', avg(15.5, 6.5, 3.5, 1.1, 0.6, 1.4, 0.480, 0.800, 1.8, 28.0, 82)),
        splitOf('002026', avg(13.0, 5.5, 3.0, 1.0, 0.5, 1.2, 0.470, 0.790, 1.7, 26.0, 60)),
      ],
    }),
    raw(999, 'Ruth Rookie', {}),
    { id: 5, player: { id: 5 } }, // no name: dropped
  ],
};

console.log('--- parsing player cards ---');
const cards = parsePlayerCards(payload, 2027);
const vale = cards.get(100);
check('keyed by player id, nameless entries dropped', cards.size === 6 && !cards.has(5));
check('name, position and team are decoded', vale.name === 'Marcus Vale' && vale.position === 'C' && vale.proTeam === 'LAL');
check('position follows ESPN\'s 1-based id', cards.get(101).position === 'SF' && cards.get(200).position === 'PG');
check('team follows ESPN\'s team id', cards.get(200).proTeam === 'NYK');
check('ACTIVE reads as Healthy', vale.injury === 'Healthy');
check('DAY_TO_DAY reads as Day-to-day', cards.get(200).injury === 'Day-to-day');
check('an unknown injury status is kept, readably',
  parsePlayerCards({ players: [raw(1, 'X Y', { injuryStatus: 'SOME_NEW_STATUS' })] }, 2027).get(1).injury === 'some new status');
check('ownership is read', vale.owned === 97.2);
check('rank is read', vale.rank === 34);
check('missing ownership and rank are null, not a crash', cards.get(101).owned === null && cards.get(101).rank === null);
check('rank falls back to the ratings block',
  parsePlayerCards({ players: [raw(2, 'A B', { ratings: { 0: { totalRanking: 12 } } })] }, 2027).get(2).rank === 12);
check('season line is read per game', vale.stats.season.pts === 18.4 && vale.stats.season.reb === 10.2 && vale.stats.season.gp === 61);
check('every category is mapped from its stat id',
  vale.stats.season.ast === 2.1 && vale.stats.season.stl === 0.8 && vale.stats.season.blk === 1.9 && vale.stats.season.tpm === 0.4 &&
  vale.stats.season.fg === 0.571 && vale.stats.season.ft === 0.684 && vale.stats.season.to === 2.0 && vale.stats.season.min === 31.2);
check('last 7, 15 and 30 are matched by their split ids',
  vale.stats.last7.pts === 21.0 && vale.stats.last15.pts === 19.2 && vale.stats.last30.pts === 18.9);
check('last season is matched too', vale.stats.prior.pts === 17.5);
check('a split for another season is not used',
  parsePlayerCards({ players: [raw(3, 'C D', { stats: [{ ...splitOf('002026', avg(9, 1, 1, 1, 1, 1, .5, .5, 1, 20, 10)) }] })] }, 2027).get(3).stats.season === null);
check('no games this season means no season line', cards.get(101).stats.season === null && cards.get(101).stats.prior.pts === 11.0);
check('the projection is read per game', cards.get(150).stats.projected.pts === 15.5 && cards.get(150).stats.projected.gp === 82);
check('a player with no projection has none', vale.stats.projected === null);
check('a zero-game split is null, not a row of zeros', cards.get(201).stats.season === null);
check('a player with nothing has all-null stats', Object.values(cards.get(999).stats).every((x) => x === null));
check('rejects a payload with no players', await throws(() => parsePlayerCards({}, 2027)));
check('also accepts the roster-entry wrapper',
  parsePlayerCards({ players: [{ playerPoolEntry: { player: { id: 7, fullName: 'E F', defaultPositionId: 1 } } }] }, 2027).has(7));

console.log('\n--- fetching cards ---');
const cfg = { leagueId: '123', season: 2027, espnS2: 's2', swid: '{abc}' };
const calls = [];
const fakeFetch = (body, status = 200) => async (url, init) => {
  calls.push({ url, headers: init.headers });
  return { ok: status < 400, status, json: async () => body };
};
clearCardCache();
let got = await fetchPlayerCards(cfg, [100, 200], { fetchImpl: fakeFetch(payload) });
check('returns parsed cards', got.get(100).name === 'Marcus Vale');
check('asks for the player card view', calls[0].url.includes('view=kona_playercard'));
check('asks for the league endpoint', calls[0].url.includes('/seasons/2027/segments/0/leagues/123'));
const sent = JSON.parse(calls[0].headers['x-fantasy-filter']);
check('filters to the ids asked for', sent.players.filterIds.value.join() === '100,200');
check('asks for every split the card shows',
  ['002027', '102027', '012027', '022027', '032027', '002026'].every((id) => sent.players.filterStatsForTopScoringPeriodIds.additionalValue.includes(id)));
check('does not ask for game-by-game stats it will not use', sent.players.filterStatsForTopScoringPeriodIds.value === 1);
check('sends the cookies', calls[0].headers.Cookie === 'espn_s2=s2; SWID={abc}');
await fetchPlayerCards(cfg, [200, 100], { fetchImpl: fakeFetch(payload) });
check('the same set (in any order) is served from the cache', calls.length === 1);
await fetchPlayerCards(cfg, [100], { fetchImpl: fakeFetch(payload) });
check('a different set is fetched', calls.length === 2);
await fetchPlayerCards(cfg, [100], { fetchImpl: fakeFetch(payload), now: Date.now() + 10 * 60_000 });
check('an old entry is fetched again', calls.length === 3);
await fetchPlayerCards(cfg, [100], { fetchImpl: fakeFetch(payload), ttlMs: 0 });
check('ttl 0 always fetches', calls.length === 4);
clearCardCache();
const before = calls.length;
await fetchPlayerCards(cfg, [100], { fetchImpl: fakeFetch(payload), games: 15 });
const g15 = JSON.parse(calls.at(-1).headers['x-fantasy-filter']).players.filterStatsForTopScoringPeriodIds.value;
check('asks for fifteen games when a chart is wanted', g15 === 15 && calls.length === before + 1);
await fetchPlayerCards(cfg, [100], { fetchImpl: fakeFetch(payload) });
check('a card fetched without games is not served from the one with games', calls.length === before + 2);
check('and the trade panel still asks for none', JSON.parse(calls.at(-1).headers['x-fantasy-filter']).players.filterStatsForTopScoringPeriodIds.value === 1);
const callsNow = calls.length;
check('no ids means no request', (await fetchPlayerCards(cfg, [], { fetchImpl: fakeFetch(payload) })).size === 0 && calls.length === callsNow);
let msg = '';
clearCardCache();
try { await fetchPlayerCards(cfg, [100], { fetchImpl: fakeFetch({}, 401) }); } catch (e) { msg = e.message; }
check('a 401 explains the cookies', msg.includes('ESPN_S2'));

console.log('\n--- the bio ---');
const bioBody = { athlete: { displayHeight: "6' 11\"", displayWeight: '245 lbs', age: 26, college: { name: 'Northern State' }, experience: { years: 5 } } };
const bio = await fetchBio(100, { fetchImpl: fakeFetch(bioBody) });
check('reads height, weight, age, college and experience',
  bio.height === "6' 11\"" && bio.weight === '245 lbs' && bio.age === 26 && bio.college === 'Northern State' && bio.experience === 5);
check('asks ESPN\'s public athlete page by id', calls.at(-1).url.endsWith('/basketball/nba/athletes/100'));
check('a 404 is null, not an error', (await fetchBio(1, { fetchImpl: fakeFetch({}, 404) })) === null);
check('a thrown error is null, not an error', (await fetchBio(1, { fetchImpl: async () => { throw new Error('boom'); } })) === null);
check('an empty athlete is null', (await fetchBio(1, { fetchImpl: fakeFetch({ athlete: {} }) })) === null);
check('a missing athlete is null', (await fetchBio(1, { fetchImpl: fakeFetch({}) })) === null);
check('a partial bio keeps what it has', (await fetchBio(1, { fetchImpl: fakeFetch({ athlete: { age: 30 } }) })).age === 30);

console.log('\n--- formatting a stat ---');
const cat = { pct: false };
const pct = { pct: true };
check('a count prints with one decimal', show(18.44, cat) === '18.4');
check('a percentage prints like a box score', show(0.5714, pct) === '.571');
check('a missing value is a dash', show(null, cat) === '—' && show(undefined, pct) === '—');
check('tidy removes backticks and extra space', tidy('  a`b   c ') === "a'b c");
check('tidy cuts to length', tidy('x'.repeat(300), 40).length === 40);
check('best line is this season when there is one', bestLine(vale).label === 'this season');
check('best line is the projection before the season starts', bestLine(cards.get(150)).label === 'projected' && bestLine(cards.get(150)).line.pts === 15.5);
check('best line is last season when there is no projection', bestLine(cards.get(101)).label === 'last season');
check('best line is nothing for a player with no stats', bestLine(cards.get(999)).line === null);
check('best line copes with a missing card', bestLine(undefined).line === null);

console.log('\n--- game logs ---');
const row = (id, period, pts, extra = {}) => ({ id, seasonId: 2027, scoringPeriodId: period, stats: { '0': pts, '6': 5 }, ...extra });
check('the card carries the games, oldest first', vale.games.length === 15 && vale.games.map((g) => g.pts).join() === valePts.join());
check('each game has its numbers and season', vale.games[0].reb === 8 && vale.games[0].season === 2027 && vale.games[0].period === 100);
check('a player with no logs has none', cards.get(150).games.length === 0 && cards.get(999).games.length === 0);
check('last season\'s games are kept as such', cards.get(101).games.length === 5 && cards.get(101).games[0].season === 2026);
check('the jersey is read', vale.jersey === '13' && cards.get(101).jersey === null);
check('windows are not mistaken for games', gameLog([{ id: '002027', stats: { '0': 9 } }, { id: '102027', stats: { '0': 9 } }, { id: '012027', stats: { '0': 9 } }]).length === 0);
check('sorted by scoring period when every game has one', gameLog([row('a1', 3, 30), row('a2', 1, 10), row('a3', 2, 20)]).map((g) => g.pts).join() === '10,20,30');
check('left in ESPN\'s order when one has no period', gameLog([row('a1', 3, 30), row('a2', null, 10, { scoringPeriodId: undefined }), row('a3', 2, 20)]).map((g) => g.pts).join() === '30,10,20');
check('only the most recent fifteen', gameLog(Array.from({ length: 20 }, (_, i) => row(`b${i}`, i, i))).length === 15 && gameLog(Array.from({ length: 20 }, (_, i) => row(`b${i}`, i, i))).at(-1).pts === 19);
check('entries with no points are skipped', gameLog([row('c1', 1, 10), { id: 'c2', stats: {} }, { id: 'c3' }]).length === 1);
check('no stats at all is no games', gameLog(undefined).length === 0 && gameLog(null).length === 0);
check('a missing stat in a game is null, not zero', gameLog([row('d1', 1, 10)])[0].ast === null);

console.log('\n--- the /player card ---');
const hasRow = (text, label) => new RegExp(`^│ ${label}\\s`, 'm').test(text);
const flat = (e) => [e.title, e.description, ...(e.fields ?? []).flatMap((f) => [f.name, f.value]), e.footer?.text ?? ''].join('\n');
const field = (e, name) => e.fields.find((f) => f.name === name)?.value;
const size = (e) => flat(e).length;
let emb = playerEmbed({ card: vale, owner: 'Ya Soul Is MIINNNEEEE', bio });
let text = flat(emb);
check('the title is the player\'s name and links to ESPN', emb.title === 'Marcus Vale' && emb.url === 'https://www.espn.com/nba/player/_/id/100');
check('the description has position, team, jersey and status', emb.description.includes('C · LAL · #13') && emb.description.includes('**Healthy**'));
check('rank, ownership and the league team are fields', field(emb, 'ESPN rank') === '#34' && field(emb, 'Owned') === '97%' && field(emb, 'In your league') === 'Ya Soul Is MIINNNEEEE');
check('those three sit side by side', emb.fields.slice(0, 3).every((f) => f.inline === true));
check('the bio is a field', field(emb, 'Bio').includes("6' 11\", 245 lbs") && field(emb, 'Bio').includes('age 26') && field(emb, 'Bio').includes('Northern State') && field(emb, 'Bio').includes('5 yrs in the league'));
check('a table of the nine categories',
  ['PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'FG%', 'FT%', 'TO'].every((c) => hasRow(field(emb, 'Per game'), c)));
check('columns are season, last 15, last 7', /│\s+Season\s+│\s+Last 15\s+│\s+Last 7\s+│/.test(text));
check('values line up in their rows', /│ PTS\s+│\s+18\.4\s+│\s+19\.2\s+│\s+21\.0/m.test(text) && /│ FG%\s+│\s+\.571\s+│\s+\.580\s+│\s+\.592/m.test(text));
check('a rising stat is marked up', /│ PTS .*↑ │$/m.test(text));
check('a falling stat is marked down', /│ AST .*↓ │$/m.test(text));
check('more turnovers is marked down, not up', /│ TO .*↓ │$/m.test(text));
check('the table is its own code block', field(emb, 'Per game').startsWith('```') && field(emb, 'Per game').endsWith('```') && (field(emb, 'Per game').match(/```/g) ?? []).length === 2);
check('the footer says how many games', emb.footer.text.includes('61 games this season'));
check('there is a headshot', emb.thumbnail.url === headshotUrl(100) && headshotUrl(100) === 'https://a.espncdn.com/i/headshots/nba/players/full/100.png');
check('healthy is green', emb.color === 0x2f9e6a);
check('no chart means no image', emb.image === undefined);
emb = playerEmbed({ card: vale, chartUrl: 'https://quickchart.io/chart?x=1' });
check('a chart becomes the embed\'s image', emb.image.url === 'https://quickchart.io/chart?x=1');
check('inside Discord\'s embed limits',
  size(emb) < 6000 && emb.fields.every((f) => f.name.length <= 256 && f.value.length <= 1024) && emb.fields.length <= 25 && emb.title.length <= 256 && emb.description.length <= 4096 && emb.footer.text.length <= 2048);
emb = playerEmbed({ card: vale, owner: null, bio: null });
check('not on a team says free agent', field(emb, 'In your league') === 'Free agent');
check('no bio, no bio field', field(emb, 'Bio') === undefined);
emb = playerEmbed({ card: cards.get(101), owner: 'T', bio: null });
check('before opening night it shows last season', /Last yr/.test(flat(emb)) && emb.footer.text.includes('showing last season'));
check('and offers no recent columns', !flat(emb).includes('Last 15') && !flat(emb).includes('Last 7'));
check('and still has the numbers', /│ PTS\s+│\s+11\.0/m.test(flat(emb)));
emb = playerEmbed({ card: cards.get(150), owner: null, bio: null });
check('before the season it shows the projection beside last season', /│\s+Proj\.\s+│\s+Last yr\s+│/.test(flat(emb)) && /│ PTS\s+│\s+15\.5\s+│\s+13\.0\s+│/m.test(flat(emb)));
check('and says so', emb.footer.text.includes('ESPN\'s projection'));
check('with no arrows, since there is nothing recent to compare', !/[↑↓→]/.test(field(emb, 'Per game')));
check('and no recent-games columns', !flat(emb).includes('Last 15') && !flat(emb).includes('Last 7'));
emb = playerEmbed({ card: cards.get(999), owner: null, bio: null });
check('no stats says so rather than printing zeros', field(emb, 'Per game').includes('No games or projection') && !field(emb, 'Per game').includes('```'));
check('a rookie with no rank shows a dash', field(emb, 'ESPN rank') === '—' && field(emb, 'Owned') === '—');
check('and has no footer', emb.footer === undefined);
emb = playerEmbed({ card: { ...vale, name: 'a`b', jersey: null }, owner: 'x`y' });
check('a backtick in a name cannot break out', !flat(emb).replace(/```/g, '').includes('`'));
check('no jersey, no number', !emb.description.includes('#'));
check('status colours: healthy green, day-to-day amber, out red, unknown grey',
  statusColor('Healthy') === 0x2f9e6a && statusColor('Day-to-day') === 0xd99a2b && statusColor('Out') === 0xd1495b && statusColor('Injured reserve') === 0xd1495b && statusColor('???') === 0x5b6270);
check('a real card for a day-to-day player is amber', playerEmbed({ card: cards.get(200) }).color === 0xd99a2b);
const tbl = statsTable(vale);
check('statsTable reports what it shows', tbl.played === true && tbl.label === 'this season' && tbl.rows.length === 13);
check('and nothing for a player without stats', statsTable(cards.get(999)) === null);
check('its rows carry no trailing spaces', statsTable(vale).rows.every((r) => r === r.trimEnd()));

console.log('\n--- the chart data ---');
let cd = chartData(vale, CATEGORIES, 2027);
check('charts points by default', cd.values.join() === valePts.join() && cd.title === 'Marcus Vale — Points, last 15 games');
cd = chartData(cards.get(101), CATEGORIES, 2027);
check('before the season, last season\'s games are named as such', cd.values.join() === '8,12,10,14,9' && cd.title === 'Jules Okafor — Points, last 5 games of 2025-26');
check('too few games means no chart', chartData({ ...vale, games: vale.games.slice(0, 2) }, CATEGORIES, 2027) === null);
const old = { ...cards.get(101), games: Array.from({ length: 6 }, (_, i) => ({ season: 2026, pts: 10 + i })) };
check('last season\'s games are named as such', chartData(old, CATEGORIES, 2027).title === 'Marcus Vale — Points, last 6 games of 2025-26'.replace('Marcus Vale', 'Jules Okafor'));
check('with no season to compare it just says recent', chartData(old, CATEGORIES, null).title.endsWith('last 6 games'));
check('a league without points charts its first counting stat', chartData({ ...vale, games: vale.games.map((g) => ({ ...g, reb: 7 })) }, categoriesFrom(['reb', 'fg']), 2027).title.includes('Rebounds'));
check('a card with no games has no chart', chartData(cards.get(999), CATEGORIES, 2027) === null && chartData({ name: 'x' }, CATEGORIES, 2027) === null);

console.log('\n--- the chart image ---');
const url = areaChartUrl({ title: 'Marcus Vale — Points, last 15 games', values: valePts });
const cfgOf = (u) => JSON.parse(decodeURIComponent(u.split('&c=')[1]));
check('it is a QuickChart URL', url.startsWith(`${QUICKCHART}?`));
check('pinned to a Chart.js version so the syntax stays valid', url.includes('v=2.9.4'));
check('with a dark background to match Discord', url.includes('bkg=%231b1d21'));
check('short enough for Discord', url.length <= MAX_URL);
let c = cfgOf(url);
check('an area chart: a filled line', c.type === 'line' && c.data.datasets[0].fill === true && /rgba/.test(c.data.datasets[0].backgroundColor));
check('with one point per game', c.data.datasets[0].data.join() === valePts.join() && c.data.labels.length === 15);
check('and the average as a dashed line', c.data.datasets[1].data.every((v) => v === 19.2) && c.data.datasets[1].borderDash.length === 2 && c.data.datasets[1].fill === false);
check('titled', c.options.title.text === 'Marcus Vale — Points, last 15 games');
check('starting from zero', c.options.scales.yAxes[0].ticks.beginAtZero === true);
check('too few games draws nothing', areaChartUrl({ title: 't', values: [1, 2] }) === null);
check('non-numbers are ignored', areaChartUrl({ title: 't', values: [1, null, 2, NaN, undefined] }) === null);
check('values are rounded for a shorter URL', cfgOf(areaChartUrl({ title: 't', values: [1.2345, 2.3456, 3.4567] })).data.datasets[0].data.join() === '1.2,2.3,3.5');
const counts = new Set();
let sawNull = false;
for (let n = 0; n <= 1500; n += 25) {
  const u = areaChartUrl({ title: 'x'.repeat(n), values: valePts });
  if (u === null) { sawNull = true; continue; }
  counts.add(cfgOf(u).data.datasets.length);
  if (u.length > MAX_URL) counts.add('TOO LONG');
}
check('a long title drops the average line before giving up', counts.has(2) && counts.has(1));
check('and an absurd one gives up rather than overflow', sawNull && !counts.has('TOO LONG'));

console.log('\n--- adding up a trade ---');

const L = (id) => ({ card: cards.get(id), ...bestLine(cards.get(id)) });
const giving = [L(100), L(101)];
const getting = [L(200)];
const sums = totals(giving);
check('counting stats are summed across a side', Math.abs(sums.pts - 29.4) < 1e-9 && Math.abs(sums.reb - 15.0) < 1e-9);
check('percentages are not summed', !('fg' in sums) && !('ft' in sums));
check('a side with no numbers totals to nothing', totals([{ line: null }]).pts === null);
const net = Object.fromEntries(netFor(giving, getting).map((n) => [n.key, n]));
check('net is what comes in minus what goes out', net.pts.delta === -8.1 && net.reb.delta === -11.0 && net.ast.delta === 3.8);
check('a gain in a good stat is better', net.ast.better === true && net.tpm.better === true);
check('a loss in a good stat is worse', net.pts.better === false && net.blk.better === false);
check('more turnovers is worse', net.to.delta === 0.5 && net.to.better === false);
check('fewer turnovers is better', netFor([L(200)], [L(100)]).find((n) => n.key === 'to').better === true);
check('no change is neither', netFor([L(100)], [L(100)]).every((n) => n.better === null));
check('only counting stats are netted', netFor(giving, getting).length === 7);
const nb = netBlock('Fernando\'s Team', netFor(giving, getting));
check('the net block signs its numbers', nb.includes('PTS -8.1') && nb.includes('AST +3.8'));
check('and labels turnovers', nb.includes('TO +0.5 (worse)'));
const st = sideTable('Fernando sends', giving);
check('a side table has a column per player and a total', /Vale\s+Okafor\s+Total/.test(st));
check('with each row', /^PTS\s+18\.4\s+11\.0\s+29\.4/m.test(st));
check('percentages show per player with no total', /^FG%\s+\.571\s+\.462\s*$/m.test(st));

console.log('\n--- the Explore buttons ---');
check('the open button is recognised', JSON.stringify(parseExploreId('trade:12:explore')) === '{"tradeId":12,"tab":"overview"}');
check('a tab button is recognised', JSON.stringify(parseExploreId('tx:12:players')) === '{"tradeId":12,"tab":"players"}');
check('other ids are not', parseExploreId('trade:12:fair') === null && parseExploreId('tx:12:charts') === null && parseExploreId(undefined) === null);
let comps = exploreComponents(12, 'players', true);
check('open: a tab row and a vote row', comps.length === 2 && comps[0].components.length === 2 && comps[1].components.length === 3);
check('the current tab is highlighted', comps[0].components.find((c) => c.label === 'Players').style === 1 && comps[0].components.find((c) => c.label === 'Overview').style === 2);
check('tab ids carry the trade', comps[0].components.map((c) => c.custom_id).join() === 'tx:12:overview,tx:12:players');
check('the vote buttons are the real ones', comps[1].components.map((c) => c.custom_id).join() === 'trade:12:fair,trade:12:collusion,trade:12:robbery');
check('closed: tabs only, no voting', exploreComponents(12, 'overview', false).length === 1);
check('the card\'s Explore button is last', voteComponents(12)[0].components.at(-1).label === 'Explore');

console.log('\n--- the Explore panel ---');
const trade = {
  id: 12, fromName: 'Fernando\'s Fantastic Team', toName: 'Ya Soul', status: 'open', proposerId: 'u1',
  give: [{ id: 100, name: 'Marcus Vale' }, { id: 101, name: 'Jules Okafor' }],
  get: [{ id: 200, name: 'Theo Brandt' }],
  closesAt: '2027-01-02T03:04:05.000Z',
};
const tally = { fair: 3, collusion: 0, robbery: 1, total: 4 };
let panel = exploreMessage({ trade, cards, tab: 'overview', tally, open: true });
check('names the trade and both teams', panel.includes('Trade #12 · Explore') && panel.includes('Ya Soul'));
check('says when voting closes and how many have voted', panel.includes('closes <t:') && panel.includes('4 votes so far'));
check('overview lists each player with position, team and injury', panel.includes('**Marcus Vale** (C, LAL, Healthy)') && panel.includes('**Theo Brandt** (PG, NYK, Day-to-day)'));
check('overview shows rank and ownership where known', panel.includes('ESPN #34, owned 97%'));
check('overview shows headline numbers', panel.includes('18.4 pts · 10.2 reb · 2.1 ast'));
check('last season is flagged as such', panel.includes('11.0 pts · 4.8 reb · 2.0 ast (last season)') && panel.includes('last season is shown'));
check('overview ends with better and worse',
  panel.includes('better in AST, 3PM; worse in PTS, REB, STL, BLK, TO'));
check('and says percentages are not netted', panel.includes('Percentages aren\'t netted'));
panel = exploreMessage({ trade, cards, tab: 'players', tally, open: true });
check('players tab has a table per side', (panel.match(/```/g) ?? []).length === 6);
check('with player columns and totals', /Vale\s+Okafor\s+Total/.test(panel) && /Brandt\s+Total/.test(panel));
check('and the net block', panel.includes('Net for Fernando\'s Fantastic Team') && panel.includes('PTS -8.1'));
panel = exploreMessage({ trade: { ...trade, status: 'approved' }, cards, tab: 'overview', tally, open: false });
check('a closed vote says so', panel.includes('Voting is closed (approved)') && !panel.includes('closes <t:'));
panel = exploreMessage({ trade: { ...trade, status: 'no_quorum' }, cards, tab: 'overview', tally, open: false });
check('statuses read as words', panel.includes('no quorum'));
panel = exploreMessage({ trade, cards: new Map(), tab: 'players', tally, open: true });
check('players ESPN returned nothing for still render', /Vale\s+Okafor\s+Total/.test(panel) && panel.includes('—'));
panel = exploreMessage({ trade, cards: new Map(), tab: 'overview', tally, open: true });
check('and say they have no stats', panel.includes('no stats yet'));
const six = {
  ...trade,
  fromName: 'F'.repeat(100), toName: 'T'.repeat(100),
  give: [100, 101, 200].map((id) => ({ id, name: 'N'.repeat(40) })),
  get: [100, 101, 200].map((id) => ({ id: id + 1000, name: 'M'.repeat(40) })),
};
check('six players with long names still fit Discord\'s 2000',
  ['overview', 'players'].every((tab) => exploreMessage({ trade: six, cards, tab, tally, open: true }).length <= 2000));
check('the singular reads right', exploreMessage({ trade, cards, tab: 'overview', tally: { ...tally, total: 1 }, open: true }).includes('1 vote so far'));

// ------------------------------------------------------------- the handlers
const rosters = {
  teams: [
    { id: 1, name: 'Fernando\'s Fantastic Team', players: [{ id: 100, name: 'Marcus Vale' }, { id: 101, name: 'Jules Okafor' }] },
    { id: 2, name: 'Ya Soul', players: [{ id: 200, name: 'Theo Brandt' }, { id: 201, name: 'Dario Reyes' }] },
  ],
  tradeDeadline: null,
};
const stubRosters = async () => rosters;
const stubCards = async () => cards;
const noSearch = async () => [];
const env0 = () => ({ FANTASY_LEAGUE_ID: '123', FANTASY_SEASON: '2027', TRADE_CHANNEL_ID: '777', DB: memoryDb() });
const NOW = Date.parse('2027-01-01T12:00:00Z');

console.log('\n--- /player ---');
{
  const env = env0();
  const asked = [];
  const run = (name, deps = {}) => handlePlayer({ data: { name: 'player', options: [{ name: 'name', value: name }] }, member: who('u1') }, env,
    { fetchRosters: stubRosters, fetchCards: async (c, ids, o) => { asked.push(o); return cards; }, fetchBio: async () => bio, ...deps });
  const flatE = (o) => [o.embeds[0].title, o.embeds[0].description, ...o.embeds[0].fields.flatMap((f) => [f.name, f.value]), o.embeds[0].footer?.text ?? ''].join('\n');
  const fld = (o, name) => o.embeds[0].fields.find((f) => f.name === name)?.value;
  let out = await run('100');
  check('replies publicly with an embed', !out.flags && out.embeds.length === 1 && out.embeds[0].title === 'Marcus Vale');
  check('and no plain text beside it', out.content === undefined);
  check('names who owns him in the league', fld(out, 'In your league') === 'Fernando\'s Fantastic Team');
  check('includes the bio', fld(out, 'Bio').includes('Northern State'));
  check('pings nobody', out.allowed_mentions.parse.length === 0);
  check('asks for his recent games so there is something to chart', asked[0].games === 15);
  check('draws the chart as the embed image', out.embeds[0].image.url.startsWith(QUICKCHART));
  check('titled with his name and what it shows', decodeURIComponent(out.embeds[0].image.url).includes('Marcus Vale — Points, last 15 games'));
  out = await run('150');
  check('a player with no games gets no chart image', out.embeds[0].image === undefined && out.embeds[0].title === 'Pat Proj');
  check('but still the projection', /Proj\./.test(flatE(out)));
  out = await run('999');
  check('a player on no team is a free agent', fld(out, 'In your league') === 'Free agent');
  out = await run('12345');
  check('a player ESPN has no card for is reported privately', out.flags === 64 && out.content.includes('no card'));
  out = await run('Marcus Vale');
  check('a typed name (not picked from the list) is refused', out.flags === 64 && out.content.includes('from the list'));
  out = await run('100', { fetchBio: async () => null });
  check('a missing bio does not stop the card', out.embeds[0].title === 'Marcus Vale' && fld(out, 'Bio') === undefined);
  out = await run('100', { fetchCards: async () => { throw new Error('ESPN 503'); } });
  check('an ESPN failure is private, not a crash', out.flags === 64 && out.content.includes('ESPN 503'));
  out = await handlePlayer({ data: { name: 'player', options: [{ name: 'name', value: '100' }] } }, {}, {});
  check('before setup, says so privately', out.flags === 64 && out.content.includes('not been connected'));
  out = await run('101');
  check('last season\'s games are charted as last season\'s', decodeURIComponent(out.embeds[0].image.url).includes('last 5 games of 2025-26'));
}

console.log('\n--- /player autocomplete ---');
{
  const env = env0();
  const ac = (typed) => ({ data: { name: 'player', options: [{ name: 'name', value: typed, focused: true }] } });
  let c = await handlePlayerAutocomplete(ac(''), env, { fetchRosters: stubRosters, searchPlayers: noSearch });
  check('offers everyone on a team, alphabetically', c.map((x) => x.name.split(' (')[0]).join() === 'Dario Reyes,Jules Okafor,Marcus Vale,Theo Brandt');
  check('labels each with their team', c.find((x) => x.value === '100').name === 'Marcus Vale (Fernando\'s Fantastic Team)');
  check('values are ids', c.every((x) => /^\d+$/.test(x.value)));
  c = await handlePlayerAutocomplete(ac('bra'), env, { fetchRosters: stubRosters, searchPlayers: noSearch });
  check('typing filters', c.length === 1 && c[0].value === '200');
  c = await handlePlayerAutocomplete(ac('zzz'), env, { fetchRosters: stubRosters, searchPlayers: noSearch });
  check('no match offers nothing', c.length === 0);
  c = await handlePlayerAutocomplete({ data: { name: 'player', options: [{ name: 'name', value: '' }] } }, env, { fetchRosters: stubRosters, searchPlayers: noSearch });
  check('nothing focused offers nothing', c.length === 0);
  check('before setup, nothing offered', (await handlePlayerAutocomplete(ac(''), {}, { fetchRosters: stubRosters, searchPlayers: noSearch })).length === 0);
  const big = { teams: [{ id: 1, name: 'T'.repeat(200), players: Array.from({ length: 40 }, (_, i) => ({ id: i, name: `P${String(i).padStart(2, '0')}` })) }] };
  c = await handlePlayerAutocomplete(ac(''), env, { fetchRosters: async () => big, searchPlayers: noSearch });
  check('never more than Discord\'s 25 choices', c.length === 25);
  check('and never a label over 100 characters', c.every((x) => x.name.length <= 100));
}

console.log('\n--- the Explore button in a real trade ---');
const link = (env, userId, teamId) =>
  handleFantasy(cmd('fantasy', 'link', { team: String(teamId) }, who(userId)), env, { fetchRosters: stubRosters });
async function withTrade() {
  const env = env0();
  const api = stubApi();
  await link(env, 'u1', 1);
  await link(env, 'u2', 2);
  await handleTrade(cmd('trade', 'propose', { team: '2', give: '100', get: '200' }, who('u1')), env, api, { fetchRosters: stubRosters, now: NOW });
  return { env, api };
}
const press = (customId, userId = 'u3', extra = {}) => ({ data: { custom_id: customId }, member: who(userId), channel_id: '999', message: { id: 'panel' }, ...extra });
{
  const { env } = await withTrade();
  env.DB.state.votes.push({ trade_id: 1, user_id: 'u3', vote: 'fair', voted_at: 'x' });
  const run = (id, userId, deps = {}) => handleTradeExplore(press(id, userId), env, { fetchCards: stubCards, now: NOW, ...deps });

  let out = await run('trade:1:explore', 'u4');
  check('Explore opens a new private message', out.update === false && out.data.flags === 64);
  check('starting on the overview', out.data.content.includes('Trade #1 · Explore') && out.data.content.includes('**Marcus Vale**'));
  check('showing the live vote count', out.data.content.includes('1 vote so far'));
  check('with tabs and vote buttons', out.data.components.length === 2);
  check('pinging nobody', out.data.allowed_mentions.parse.length === 0);
  out = await run('tx:1:players', 'u4');
  check('a tab press rewrites the same message', out.update === true && /Total/.test(out.data.content));
  check('and highlights that tab', out.data.components[0].components.find((c) => c.label === 'Players').style === 1);
  out = await run('trade:1:explore', 'u1');
  check('the managers can look too', out.data.content.includes('Explore'));

  env.DB.state.trades[0].status = 'approved';
  out = await run('trade:1:explore', 'u4');
  check('after the vote, it says voting is closed', out.data.content.includes('Voting is closed'));
  check('and offers no vote buttons', out.data.components.length === 1);
  env.DB.state.trades[0].status = 'open';
  out = await handleTradeExplore(press('trade:1:explore'), env, { fetchCards: stubCards, now: NOW + 25 * 3600 * 1000 });
  check('an open trade past its time reads as closed', out.data.content.includes('Voting is closed') && out.data.components.length === 1);

  out = await run('trade:99:explore', 'u4');
  check('a trade that is gone says so', out.data.flags === 64 && out.data.content.includes('no longer exists') && out.update === false);
  out = await run('trade:1:explore', 'u4', { fetchCards: async () => { throw new Error('ESPN 503'); } });
  check('an ESPN failure is private', out.data.content.includes('ESPN 503') && out.update === false);
  out = await run('nonsense', 'u4');
  check('a stray id is refused', out.data.flags === 64);
  out = await handleTradeExplore(press('trade:1:explore'), {}, {});
  check('before setup, says so privately', out.data.content.includes('not been connected'));

  let asked;
  await run('trade:1:explore', 'u4', { fetchCards: async (_c, ids) => { asked = ids; return cards; } });
  check('asks ESPN for every player in the trade, once', asked.join() === '100,200');
}

console.log('\n--- voting from inside the panel ---');
{
  const { env, api } = await withTrade();
  // A press inside the private panel: the clicked message is the panel, not the card.
  const out = await handleTradeVote(
    { data: { custom_id: 'trade:1:fair' }, member: who('u3'), channel_id: '999', message: { id: 'panel-message' } },
    env, api, { now: NOW }
  );
  check('the vote is recorded', out.content.includes('Vote recorded') && env.DB.state.votes.length === 1);
  check('the public card is redrawn, not the panel', api.edited.at(-1).id === 'm1' && api.edited.at(-1).channel === '777');
  check('and the panel is left alone', !api.edited.some((e) => e.id === 'panel-message'));
}


console.log('\n--- the league own categories ---');
const eight = [0, 1, 2, 3, 6, 17, 19, 20].map((statId) => ({ statId }));
const leagueJson = (items) => ({
  teams: [{ id: 1, name: 'A', roster: { entries: [{ playerId: 100, playerPoolEntry: { player: { fullName: 'Marcus Vale' } } }] } }],
  settings: { scoringSettings: { scoringItems: items }, tradeSettings: { deadlineDate: 5 } },
});
let pr = parseRosters(leagueJson(eight));
check('reads the categories the league scores, in display order', pr.categories.join() === 'pts,reb,ast,stl,blk,tpm,fg,ft');
check('a league without turnovers has none', !pr.categories.includes('to'));
check('a league that scores turnovers has them', parseRosters(leagueJson([...eight, { statId: 11 }])).categories.includes('to'));
check('no scoring settings means unknown, not empty', parseRosters({ teams: [] }).categories === null);
check('settings with nothing recognisable mean unknown', parseRosters(leagueJson([{ statId: 99 }])).categories === null);
check('the rest of the parse is unchanged', pr.tradeDeadline === 5 && pr.teams[0].players[0].id === 100);
const eightCats = categoriesFrom(pr.categories);
check('categoriesFrom picks exactly those', eightCats.length === 8 && eightCats.every((c) => pr.categories.includes(c.key)));
check('and keeps the display order', eightCats.map((c) => c.label).join() === 'PTS,REB,AST,STL,BLK,3PM,FG%,FT%');
check('unknown means all nine', categoriesFrom(null) === CATEGORIES && categoriesFrom([]).length === 9);
check('keys it does not recognise fall back to all nine', categoriesFrom(['bogus']).length === 9);

const flatEmbed = (e) => [e.title, e.description, ...(e.fields ?? []).flatMap((f) => [f.name, f.value]), e.footer?.text ?? ''].join('\n');
let card8 = flatEmbed(playerEmbed({ card: vale, owner: null, bio: null, cats: eightCats }));
check('the /player card leaves out an unscored category', !hasRow(card8, 'TO') && hasRow(card8, 'FT%'));
check('and still has the scored ones', ['PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'FG%', 'FT%'].every((c) => hasRow(card8, c)));
check('by default it still shows all nine', hasRow(flatEmbed(playerEmbed({ card: vale })), 'TO'));
check('totals follow the league\'s categories', !('to' in totals([L(100)], eightCats)) && 'pts' in totals([L(100)], eightCats));
check('so does the net', netFor(giving, getting, eightCats).every((n) => n.key !== 'to') && netFor(giving, getting, eightCats).length === 6);
check('and the side tables', !/^TO\s/m.test(sideTable('x', giving, eightCats)) && /^FT%\s/m.test(sideTable('x', giving, eightCats)));
let p8 = exploreMessage({ trade, cards, tab: 'players', tally, open: true, cats: eightCats });
check('the Explore Players tab leaves it out', !/^TO\s/m.test(p8) && !p8.includes('TO +'));
p8 = exploreMessage({ trade, cards, tab: 'overview', tally, open: true, cats: eightCats });
check('the Explore Overview does not call turnovers worse', p8.includes('worse in PTS, REB, STL, BLK') && !/worse in [^.]*TO/.test(p8));

console.log('\n--- projections in the Explore panel ---');
const projTrade = { ...trade, give: [{ id: 150, name: 'Pat Proj' }], get: [{ id: 100, name: 'Marcus Vale' }] };
let pp = exploreMessage({ trade: projTrade, cards, tab: 'overview', tally, open: true });
check('a projected player is marked as such', pp.includes('15.5 pts · 6.5 reb · 3.5 ast (proj.)'));
check('a played player is not marked', pp.includes('18.4 pts · 10.2 reb · 2.1 ast\n'));
check('the note mentions projections', pp.includes('ESPN\'s projection or last season'));
check('last season is still marked', exploreMessage({ trade, cards, tab: 'overview', tally, open: true }).includes('(last season)'));

console.log('\n--- searching for any player ---');
clearSearchCache();
const searchCalls = [];
const searchFetch = (body, status = 200) => async (url, init) => {
  searchCalls.push({ url, headers: init.headers });
  return { ok: status < 400, status, json: async () => body };
};
const found = { players: [
  { player: { id: 3112335, fullName: 'Nikola Jokic', defaultPositionId: 5, proTeamId: 7 } },
  { player: { id: 77, fullName: 'Nameless Position', defaultPositionId: 99, proTeamId: 999 } },
  { player: { id: 78 } },
] };
let res = await searchPlayers(cfg, 'jok', { fetchImpl: searchFetch(found) });
check('returns the players ESPN found', res.length === 2 && res[0].name === 'Nikola Jokic');
check('with position and team decoded', res[0].position === 'C' && res[0].proTeam === 'DEN');
check('and tolerates an unknown position or team', res[1].position === '' && res[1].proTeam === '');
check('drops entries with no name', !res.some((r) => r.id === 78));
const sf = JSON.parse(searchCalls[0].headers['x-fantasy-filter']).players;
check('uses ESPN\'s player search view', searchCalls[0].url.includes('view=kona_player_info'));
check('filters by the name typed, across every status', sf.filterName.value === 'jok' && sf.filterStatus.value.join() === 'FREEAGENT,WAIVERS,ONTEAM');
check('most-owned first, and capped', sf.sortPercOwned.sortAsc === false && sf.limit === 15);
await searchPlayers(cfg, 'JOK', { fetchImpl: searchFetch(found) });
check('the same search (any case) is served from the cache', searchCalls.length === 1);
await searchPlayers(cfg, 'jokic', { fetchImpl: searchFetch(found) });
check('a different search is fetched', searchCalls.length === 2);
await searchPlayers(cfg, 'jok', { fetchImpl: searchFetch(found), now: Date.now() + 5 * 60_000 });
check('an old search is fetched again', searchCalls.length === 3);
check('a malformed answer is an error', await throws(() => searchPlayers(cfg, 'zzz', { fetchImpl: searchFetch({}) })));
check('an ESPN error is an error', await throws(() => searchPlayers(cfg, 'yyy', { fetchImpl: searchFetch({}, 500) })));

console.log('\n--- /player autocomplete with search ---');
{
  const env = env0();
  const ac = (typed) => ({ data: { name: 'player', options: [{ name: 'name', value: typed, focused: true }] } });
  const calls2 = [];
  const search = async (_c, term) => { calls2.push(term); return [
    { id: 3112335, name: 'Nikola Jokic', position: 'C', proTeam: 'DEN' },
    { id: 200, name: 'Theo Brandt', position: 'PG', proTeam: 'NYK' },
  ]; };
  const run = (typed, s = search) => handlePlayerAutocomplete(ac(typed), env, { fetchRosters: stubRosters, searchPlayers: s });
  let c = await run('bra');
  check('from three letters it asks ESPN', calls2.join() === 'bra');
  check('an undrafted player is offered, with position and team', c.find((x) => x.value === '3112335').name === 'Nikola Jokic (C, DEN)');
  check('a rostered player shows the team that has him', c.find((x) => x.value === '200').name === 'Theo Brandt (Ya Soul)');
  check('a player in both lists appears once', c.filter((x) => x.value === '200').length === 1);
  check('search results come first, in ESPN\'s order', c[0].value === '3112335');
  c = await run('Ma');
  check('under three letters it does not ask ESPN', calls2.length === 1);
  check('and still matches the rostered list', c.map((x) => x.value).join() === '100');
  c = await run('bra', async () => { throw new Error('ESPN 503'); });
  check('if search fails, rostered players still appear', c.map((x) => x.value).join() === '200');
  c = await run('zzzz', async () => []);
  check('no match anywhere offers nothing', c.length === 0);
  const many = async () => Array.from({ length: 40 }, (_, i) => ({ id: 1000 + i, name: `Player ${i}`, position: 'C', proTeam: 'DEN' }));
  c = await run('pla', many);
  check('never more than Discord\'s 25', c.length === 25 && c.every((x) => x.name.length <= 100));
  c = await run('  bra  ');
  check('typed spaces are ignored', calls2.at(-1) === 'bra');
}

console.log('\n--- the panel and the card use the league\'s categories ---');
{
  const { env } = await withTrade();
  const cats8 = { ...rosters, categories: ['pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'fg', 'ft'] };
  let out = await handleTradeExplore(press('tx:1:players', 'u4'), env, { fetchCards: stubCards, fetchRosters: async () => cats8, now: NOW });
  check('the Explore panel follows the league', !/^TO\s/m.test(out.data.content) && /^FT%\s/m.test(out.data.content));
  out = await handleTradeExplore(press('tx:1:players', 'u4'), env, { fetchCards: stubCards, fetchRosters: async () => { throw new Error('ESPN 503'); }, now: NOW });
  check('if the settings cannot be read it shows everything, not nothing', /^TO\s/m.test(out.data.content));
  out = await handleTradeExplore(press('tx:1:players', 'u4'), env, { fetchCards: stubCards, fetchRosters: stubRosters, now: NOW });
  check('settings without categories also show everything', /^TO\s/m.test(out.data.content));
  const pOut = await handlePlayer({ data: { name: 'player', options: [{ name: 'name', value: '100' }] }, member: who('u1') }, env,
    { fetchRosters: async () => cats8, fetchCards: stubCards, fetchBio: async () => null });
  const pFlat = flatEmbed(pOut.embeds[0]);
  check('/player follows the league', !hasRow(pFlat, 'TO') && hasRow(pFlat, 'FT%'));
}


console.log('\n--- the spreadsheet grid ---');
const g = grid(['', 'A', 'Bee'], [['x', '1.5', '22.25'], ['yy', '10', '3']], ['left', 'right', 'right']);
check('ruled top, header rule and bottom', g[0].startsWith('┌') && g[0].endsWith('┐') && g[2].startsWith('├') && g[2].endsWith('┤') && g.at(-1).startsWith('└') && g.at(-1).endsWith('┘'));
check('every line is the same width', new Set(g.map((l) => l.length)).size === 1);
check('columns are as wide as their widest cell plus a space either side', g[1] === '│    │  A  │   Bee │'.replace('│   Bee │', '│  Bee  │') || g[1].includes('Bee'));
check('numbers are right-aligned', /│  10 │     3 │$/.test(g[4]) && /│ 1\.5 │ 22\.25 │$/.test(g[3]));
check('the header is centred', /│\s+A\s+│/.test(g[1]));
check('text is left-aligned', g[3].startsWith('│ x '));
check('there is a rule between the columns on every rule line', g[0].split('┬').length === 3 && g[2].split('┼').length === 3 && g.at(-1).split('┴').length === 3);
check('an empty cell does not break the layout', grid(['a', 'b'], [['', null]]).every((l, _, all) => l.length === all[0].length));
const realGrid = statsTable(vale, categoriesFrom(['pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'fg', 'ft'])).rows;
check('the /player table is about a phone wide', Math.max(...realGrid.map((l) => l.length)) <= 38);
check('and its lines are all the same width', new Set(realGrid.map((l) => l.length)).size === 1);

console.log('\n--- comparing players ---');
const cmpCards = [vale, cards.get(200), cards.get(150)];
const owners = new Map([[100, 'Ya Soul']]);
let ce = compareEmbed({ cards: cmpCards, owners, cats: categoriesFrom(['pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'fg', 'ft']), season: 2027 });
const cfield = (name) => ce.fields.find((f) => f.name === name)?.value;
const ctable = cfield('Per game');
check('titled with everyone compared', ce.title === 'Marcus Vale vs Theo Brandt vs Pat Proj');
check('a field per player, side by side', ce.fields.slice(0, 3).map((f) => f.name).join() === 'Marcus Vale,Theo Brandt,Pat Proj' && ce.fields.slice(0, 3).every((f) => f.inline));
check('each shows position, team, jersey, status, rank, ownership and owner', cfield('Marcus Vale').includes('C · LAL · #13') && cfield('Marcus Vale').includes('**Healthy**') && cfield('Marcus Vale').includes('ESPN #34 · owned 97%') && cfield('Marcus Vale').includes('Ya Soul'));
check('a free agent says so', cfield('Theo Brandt').includes('Free agent') && cfield('Theo Brandt').includes('**Day-to-day**'));
check('the table has a column per player, by surname', /│\s+Vale\s+│\s+Brandt\s+│\s+Proj\s+│/.test(ctable));
check('a row per scored category, none for unscored', ['PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'FG%', 'FT%'].every((c) => hasRow(ctable, c)) && !hasRow(ctable, 'TO'));
check('a Basis row says what each column is', /│ Basis\s+│\s+season\s+│\s+season\s+│\s+proj\.\s+│/.test(ctable));
check('the best value in a row is starred', /│ PTS\s+│\s+18\.4\s+│\s+21\.3\*\s+│\s+15\.5\s+│/.test(ctable) && /│ REB\s+│\s+10\.2\*\s+│/.test(ctable));
check('percentages are starred too', /│ FT%\s+│\s+\.684\s+│\s+\.872\*\s+│/.test(ctable));
check('a Leads row counts the categories each leads', /│ Leads\s+│\s+3 of 8\s+│\s+5 of 8\s+│\s+0 of 8\s+│/.test(ctable));
check('the numbers all line up with the stars', new Set(ctable.split('\n').filter((l) => l.startsWith('│') || l.startsWith('┌') || l.startsWith('├') || l.startsWith('└')).map((l) => l.length)).size === 1);
check('the footer explains the star', ce.footer.text.includes('* best in the category'));
check('and warns when the bases differ', ce.footer.text.includes('different bases'));
check('no chart when fewer than two of them have recent games', ce.image === undefined && !ce.footer.text.includes('Chart'));
const withGames = compareEmbed({ cards: [vale, cards.get(101)], owners, cats: CATEGORIES, season: 2027 });
check('there is a chart when two have games', withGames.image.url.startsWith(QUICKCHART));
check('titled with who is compared and what', decodeURIComponent(withGames.image.url).includes('Vale vs Okafor — Points, recent games'));
check('the footer says how it is lined up', withGames.footer.text.includes('lines the latest games up at the right'));
check('and flags games from last season', withGames.footer.text.includes('Some games are from last season'));
check('but not when they are all this season', !compareEmbed({ cards: [vale, { ...vale, id: 9, name: 'Other Vale' }], cats: CATEGORIES, season: 2027 }).footer.text.includes('last season'));
const sameBasis = compareEmbed({ cards: [vale, cards.get(200)], owners, cats: CATEGORIES, season: 2027 });
check('no basis warning when everyone is on the same one', !sameBasis.footer.text.includes('different bases'));
check('turnovers: fewer is better when the league scores them', (() => {
  const e = compareEmbed({ cards: [vale, cards.get(200)], owners, cats: CATEGORIES, season: 2027 });
  return /│ TO\s+│\s+2\.0\*\s+│\s+3\.6\s+│/.test(e.fields.at(-1).value);
})());
const tie = { ...vale, id: 1, name: 'Twin One', stats: { ...vale.stats, season: { ...vale.stats.season } } };
const twin = { ...vale, id: 2, name: 'Twin Two', stats: { ...vale.stats, season: { ...vale.stats.season } } };
const tieTable = compareEmbed({ cards: [tie, twin], cats: categoriesFrom(['pts']) }).fields.at(-1).value;
check('a tie stars both', /│ PTS\s+│\s+18\.4\*\s+│\s+18\.4\*\s+│/.test(tieTable));
const near = { ...vale, id: 3, name: 'Near A', stats: { ...vale.stats, season: { ...vale.stats.season, pts: 18.44 } } };
const near2 = { ...vale, id: 4, name: 'Near B', stats: { ...vale.stats, season: { ...vale.stats.season, pts: 18.41 } } };
check('values that print the same count as tied', /18\.4\*\s+│\s+18\.4\*/.test(compareEmbed({ cards: [near, near2], cats: categoriesFrom(['pts']) }).fields.at(-1).value));
const sameName = compareEmbed({ cards: [{ ...vale, id: 5, name: 'Jaylen Williams' }, { ...vale, id: 6, name: 'Ron Williams' }], cats: categoriesFrom(['pts']) }).fields.at(-1).value;
check('two players with one surname get first initials', sameName.includes('J. Williams') && sameName.includes('R. Williams'));
check('long names are cut to fit', /│\s+Bartholome\s+│/.test(compareEmbed({ cards: [{ ...vale, name: 'Al Bartholomew-Johnson' }, cards.get(200)], cats: categoriesFrom(['pts']) }).fields.at(-1).value));
const barely = compareEmbed({ cards: [cards.get(999), cards.get(200)], cats: categoriesFrom(['pts']) });
check('with one side having no stats there is nothing to lead', barely.footer.text.includes('Not enough stats') && !barely.fields.at(-1).value.includes('Leads'));
check('and its column shows dashes', /│ PTS\s+│\s+—\s+│\s+21\.3\s+│/.test(barely.fields.at(-1).value));
check('two players is the least', compareEmbed({ cards: [vale, cards.get(200)], cats: CATEGORIES }).fields.length === 3);
const four = compareEmbed({ cards: [vale, cards.get(200), cards.get(150), cards.get(101)], cats: CATEGORIES, season: 2027 });
check('four players fit Discord\'s limits', four.fields.length === 5 && four.fields.every((f) => f.name.length <= 256 && f.value.length <= 1024) && flat(four).length < 6000);
check('and the table stays about as wide as a phone allows', Math.max(...four.fields.at(-1).value.split('\n').map((l) => l.length)) <= 60);
check('no stray backticks from names', !flat(compareEmbed({ cards: [{ ...vale, name: 'a`b' }, cards.get(200)], owners: new Map([[100, 'x`y']]), cats: CATEGORIES })).replace(/```/g, '').includes('`'));

console.log('\n--- the comparison chart ---');
const ser = (label, vals) => ({ label, values: vals });
const cc = (u) => JSON.parse(decodeURIComponent(u.split('&c=')[1]));
let cu = compareChartUrl({ title: 'A vs B', series: [ser('A', valePts), ser('B', valePts.map((v) => v + 3))] });
check('an overlaid area chart', cc(cu).data.datasets.length === 2 && cc(cu).data.datasets.every((d) => d.fill === true));
check('one colour per player', cc(cu).data.datasets[0].borderColor === SERIES_COLORS[0] && cc(cu).data.datasets[1].borderColor === SERIES_COLORS[1]);
check('with a legend naming them', cc(cu).options.legend.display !== false && cc(cu).data.datasets.map((d) => d.label).join() === 'A,B');
check('short enough for Discord', cu.length <= MAX_URL);
cu = compareChartUrl({ title: 't', series: [ser('A', valePts), ser('B', [5, 6, 7, 8])] });
check('latest games line up at the right, with a gap on the left', cc(cu).data.datasets[1].data.slice(-4).join() === '5,6,7,8' && cc(cu).data.datasets[1].data.slice(0, 11).every((v) => v === null));
check('a player with under three games is left out', compareChartUrl({ title: 't', series: [ser('A', valePts), ser('B', [1, 2])] }) === null);
check('fewer than two usable players draws nothing', compareChartUrl({ title: 't', series: [ser('A', valePts)] }) === null);
const four15 = ['A', 'B', 'C', 'D'].map((l, i) => ser(l, valePts.map((v) => v + i)));
cu = compareChartUrl({ title: 'A vs B vs C vs D — Points, recent games', series: four15 });
check('four players still fit', cu !== null && cu.length <= MAX_URL && cc(cu).data.datasets.length === 4);
const lens = new Set();
for (let n = 0; n <= 1200; n += 40) {
  const u = compareChartUrl({ title: 'x'.repeat(n), series: four15 });
  if (u) { lens.add(cc(u).data.labels.length); if (u.length > MAX_URL) lens.add('TOO LONG'); }
}
check('when it will not fit it uses fewer games rather than overflow', lens.has(15) && (lens.has(10) || lens.has(7)) && !lens.has('TOO LONG'));
check('non-numbers are ignored', compareChartUrl({ title: 't', series: [ser('A', [1, null, 2, NaN, 3, 4]), ser('B', [1, 2, 3])] }) !== null);

console.log('\n--- /compare ---');
{
  const env = env0();
  const asked = [];
  const run = (opts, deps = {}) => handleCompare({ data: { name: 'compare', options: Object.entries(opts).map(([name, value]) => ({ name, value })) }, member: who('u1') }, env,
    { fetchRosters: stubRosters, fetchCards: async (_c, ids, o) => { asked.push({ ids, o }); return cards; }, ...deps });
  let out = await run({ player1: '100', player2: '200' });
  check('replies publicly with an embed', !out.flags && out.embeds.length === 1 && out.embeds[0].title === 'Marcus Vale vs Theo Brandt');
  check('pings nobody', out.allowed_mentions.parse.length === 0);
  check('one card request covers every player, with game logs', asked.length === 1 && asked[0].ids.join() === '100,200' && asked[0].o.games === 15);
  check('says who has each player in the league', out.embeds[0].fields[0].value.includes('Fernando\'s Fantastic Team') && out.embeds[0].fields[1].value.includes('Ya Soul'));
  out = await run({ player1: '100', player2: '200', player3: '150', player4: '101' });
  check('up to four', out.embeds[0].fields.length === 5);
  out = await run({ player1: '100' });
  check('one player is not a comparison', out.flags === 64 && out.content.includes('at least two'));
  out = await run({ player1: '100', player2: '100' });
  check('the same player twice is refused', out.flags === 64 && out.content.includes('different players'));
  out = await run({ player1: '100', player2: 'Theo' });
  check('a typed name is refused', out.flags === 64 && out.content.includes('from the list'));
  out = await run({ player1: '100', player2: '12345' });
  check('a player ESPN has no card for is reported privately', out.flags === 64 && out.content.includes('12345'));
  out = await run({ player1: '100', player2: '200' }, { fetchCards: async () => { throw new Error('ESPN 503'); } });
  check('an ESPN failure is private, not a crash', out.flags === 64 && out.content.includes('ESPN 503'));
  out = await run({ player1: '100', player2: '200' }, { fetchRosters: async () => ({ ...rosters, categories: ['pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'fg', 'ft'] }) });
  check('it follows the league\'s categories', !hasRow(out.embeds[0].fields.at(-1).value, 'TO') && hasRow(out.embeds[0].fields.at(-1).value, 'FT%'));
  out = await handleCompare({ data: { name: 'compare', options: [] } }, {}, {});
  check('before setup, says so privately', out.flags === 64 && out.content.includes('not been connected'));
}
const cmp = COMMANDS.find((c) => c.name === 'compare');
check('/compare is registered', Boolean(cmp));
check('two players are required, two more optional', cmp.options.map((o) => `${o.name}:${o.required}`).join() === 'player1:true,player2:true,player3:false,player4:false');
check('every player autocompletes', cmp.options.every((o) => o.autocomplete === true));
check('it is open to everyone', cmp.default_member_permissions === undefined);
check('description fits Discord\'s 100', [...cmp.description].length <= 100);

console.log('\n--- the command definition ---');
const pl = COMMANDS.find((c) => c.name === 'player');
check('/player is registered', Boolean(pl));
check('it takes one required name', pl.options.length === 1 && pl.options[0].name === 'name' && pl.options[0].required === true);
check('the name autocompletes', pl.options[0].autocomplete === true);
check('it is open to everyone', pl.default_member_permissions === undefined);
check('description fits Discord\'s 100', [...pl.description].length <= 100);

if (fails.length) { console.log(`\n${fails.length} FAILED`); process.exit(1); }
console.log('\nall player checks passed');
