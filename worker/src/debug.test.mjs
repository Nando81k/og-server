/**
 * /fantasy debug: the diagnostic that reports what ESPN really sends.
 *
 * Fixtures are hand-built in the shapes this bot assumes, so these tests prove
 * the report is built correctly from them (and that it survives the shapes
 * being wrong). Whether ESPN actually sends those shapes is exactly what the
 * command is for, and only running it against the real league answers that.
 */

import { diagnose, diagnosticMessage } from './fantasy.mjs';
import { handleFantasy, handleFantasyAutocomplete } from './index.mjs';
import { COMMANDS, FANTASY_MOD_ONLY } from '../../shared/commands.mjs';
import { who, MOD, cmd } from './test-db.mjs';
import { readFileSync } from 'node:fs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };

const cfg = { leagueId: '123', season: 2027, espnS2: 'secret-s2-value', swid: '{SECRET-SWID}' };
const leagueBody = {
  teams: Array.from({ length: 10 }, (_, i) => ({ id: i + 1 })),
  scoringPeriodId: 1,
  status: { finalScoringPeriod: 177, currentMatchupPeriod: 1 },
  settings: {
    scoringSettings: {
      scoringType: 'H2H_CATEGORY',
      scoringItems: [0, 6, 3, 2, 1, 17, 19, 20, 11].map((statId) => ({ statId, isReverseItem: statId === 11 })),
    },
    tradeSettings: { deadlineDate: Date.parse('2027-02-20T00:00:00Z'), revisionHours: 24, vetoVotesRequired: 4 },
  },
};
const log = (id) => ({ id, seasonId: 2027, scoringPeriodId: 5, averageStats: { '0': 20 }, stats: { '0': 20 } });
const cardBody = {
  players: [{
    id: 100,
    player: {
      id: 100, fullName: 'Marcus Vale', defaultPositionId: 5, proTeamId: 13,
      ownership: { percentOwned: 97.2, percentStarted: 90 },
      draftRanksByRankType: { STANDARD: { rank: 34 } },
      ratings: { 0: { totalRanking: 34 } },
      stats: [
        { id: '002027', seasonId: 2027, averageStats: { '0': 18 } },
        { id: '102027', seasonId: 2027, stats: { '0': 19 } },
        { id: '012027', seasonId: 2027, averageStats: { '0': 21 } },
        { id: '002026', seasonId: 2026, averageStats: { '0': 17 } },
        ...Array.from({ length: 15 }, (_, i) => log(`46202${i}`)),
      ],
    },
  }],
};
const bioBody = { athlete: { displayHeight: "6' 11\"", displayWeight: '245 lbs', age: 26, college: { name: 'Northern State' } } };

const calls = [];
const route = (overrides = {}) => async (url, init) => {
  calls.push({ url, headers: init?.headers ?? {} });
  const pick = (key, body) => {
    const status = overrides[key] ?? 200;
    return { ok: status < 400, status, json: async () => body };
  };
  if (url.includes('site.web.api.espn.com')) return pick('bio', bioBody);
  if (url.includes('kona_playercard')) return pick('card', cardBody);
  return pick('league', leagueBody);
};

console.log('--- gathering the facts ---');
const facts = await diagnose(cfg, 100, { fetchImpl: route() });
check('no failures when everything answers', facts.errors.length === 0);
check('reads the scoring format', facts.league.scoringType === 'H2H_CATEGORY');
check('reads the categories', facts.league.categories.join() === '0,6,3,2,1,17,19,20,11');
check('reads which are lower-is-better', facts.league.reversed.join() === '11');
check('reads the team count and periods', facts.league.teams === 10 && facts.league.scoringPeriodId === 1 && facts.league.finalScoringPeriod === 177 && facts.league.matchupPeriod === 1);
check('reads the trade deadline where it is assumed to be', facts.league.deadline === Date.parse('2027-02-20T00:00:00Z'));
check('lists the trade settings it found', facts.league.tradeKeys.join() === 'deadlineDate,revisionHours,vetoVotesRequired');
check('names the player', facts.card.name === 'Marcus Vale');
check('lists the player\'s fields', facts.card.playerKeys.includes('ownership') && facts.card.playerKeys.includes('stats'));
check('finds ownership', facts.card.percentOwned === 97.2 && facts.card.ownershipKeys.includes('percentStarted'));
check('finds ranks', facts.card.rankKeys.join() === 'STANDARD' && facts.card.ratingKeys.join() === '0');
check('lists the splits and marks per-game ones', facts.card.splits.join() === '002027*,102027,012027*,002026*');
check('lists the seasons present', facts.card.seasons.join() === '2027,2026');
check('counts game logs apart from splits', facts.card.logCount === 15 && facts.card.logIds.length === 3);
check('notes whether logs carry per-game numbers', facts.card.logsHaveAverages === true && facts.card.logsHaveStats === true);
check('reads which bio fields exist', facts.bio.status === 200 && facts.bio.fields.join() === 'displayHeight,displayWeight,age,college');

console.log('\n--- what it asks ESPN for ---');
const cardCall = calls.find((c) => c.url.includes('kona_playercard'));
const filter = JSON.parse(cardCall.headers['x-fantasy-filter']).players;
check('asks about the one player', filter.filterIds.value.join() === '100');
check('asks for game-by-game logs', filter.filterStatsForTopScoringPeriodIds.value === 15);
check('asks for every split', ['002027', '102027', '012027', '022027', '032027'].every((id) => filter.filterStatsForTopScoringPeriodIds.additionalValue.includes(id)));
check('and four earlier seasons', ['002026', '002025', '002024', '002023'].every((id) => filter.filterStatsForTopScoringPeriodIds.additionalValue.includes(id)));
check('asks the settings view for the league', calls.some((c) => c.url.includes('view=mSettings')));
check('sends the cookies to ESPN\'s fantasy API', cardCall.headers.Cookie.includes('secret-s2-value'));
check('but not to the public bio page', !calls.find((c) => c.url.includes('site.web.api.espn.com')).headers.Cookie);

console.log('\n--- the report ---');
let text = diagnosticMessage(facts);
check('shows the scoring format and team count', text.includes('scoring: H2H_CATEGORY · 10 teams'));
check('shows the periods', text.includes('scoring period 1 of 177 · matchup period 1'));
check('shows the categories and the reversed one', text.includes('0, 6, 3, 2, 1, 17, 19, 20, 11') && text.includes('lower is better: 11'));
check('shows the deadline and settings', text.includes('2027-02-20') && text.includes('deadlineDate'));
check('shows the player card section', text.includes('**Player card: Marcus Vale**'));
check('shows ownership and ranks', text.includes('ownership: 97.2') && text.includes('ranks: STANDARD'));
check('shows splits with the per-game marker', text.includes('002027*'));
check('shows the game log verdict', text.includes('game logs: 15') && text.includes('per-game: yes'));
check('shows the bio verdict', text.includes('**Bio page:** HTTP 200 · has displayHeight'));
check('has no failure section when nothing failed', !text.includes('Failed'));
check('fits Discord\'s 2000', text.length <= 2000);
check('contains no cookie or token', !text.includes('secret-s2-value') && !text.includes('SECRET-SWID'));

console.log('\n--- when ESPN is not what we assumed ---');
let f = await diagnose(cfg, 100, { fetchImpl: route({ league: 500 }) });
check('one part failing does not stop the others', f.errors.length === 1 && f.errors[0].startsWith('league:') && f.card && f.bio);
text = diagnosticMessage(f);
check('the failure is reported', text.includes('**Failed:**') && text.includes('league:'));
check('and the parts that worked are still shown', text.includes('Player card') && text.includes('Bio page'));
f = await diagnose(cfg, 100, { fetchImpl: route({ league: 401 }) });
check('a 401 names the cookies', f.errors[0].includes('ESPN_S2'));
f = await diagnose(cfg, 100, { fetchImpl: route({ bio: 404 }) });
check('a missing bio page is a finding, not a failure', f.errors.length === 0 && f.bio.status === 404 && diagnosticMessage(f).includes('HTTP 404 · has nothing usable'));
f = await diagnose(cfg, 100, { fetchImpl: async () => { throw new Error('network down'); } });
check('everything failing still returns a report', f.errors.length === 3);
check('and it renders', diagnosticMessage(f).includes('network down'));

const bare = { league: { scoringType: null, teams: null, scoringPeriodId: null, finalScoringPeriod: null, matchupPeriod: null, categories: null, reversed: null, tradeKeys: [], deadline: null },
  card: { name: null, entryKeys: [], playerKeys: [], ownershipKeys: [], percentOwned: null, rankKeys: [], ratingKeys: [], splits: [], seasons: [], logCount: 0, logIds: [], logsHaveAverages: null, logsHaveStats: null },
  bio: { status: 200, fields: [] }, errors: [] };
text = diagnosticMessage(bare);
check('absent trade settings say so', text.includes('none found') && text.includes('absent'));
check('absent ownership and ranks say so', text.includes('no percentOwned') && text.includes('no draftRanks'));
check('no splits and no logs say so', text.includes('splits (* = per-game): none') && text.includes('game logs: 0'));
check('unknown values show a question mark, not undefined', !text.includes('undefined') && !text.includes('null'));
const huge = { ...facts, errors: Array.from({ length: 50 }, () => 'x'.repeat(300)) };
check('a long report is cut to Discord\'s 2000', diagnosticMessage(huge).length <= 2000);

console.log('\n--- the command ---');
const rosters = { teams: [{ id: 1, name: 'A', players: [{ id: 100, name: 'Marcus Vale' }, { id: 101, name: 'Jules Okafor' }] }], tradeDeadline: null };
const env = { FANTASY_LEAGUE_ID: '123', FANTASY_SEASON: '2027' };
let seen = [];
const deps = { fetchRosters: async () => rosters, diagnose: async (_c, id) => { seen.push(id); return facts; } };
let out = await handleFantasy(cmd('fantasy', 'debug', {}, who('u1')), env, deps);
check('a member is refused', out.flags === 64 && out.content.includes('Only mods') && seen.length === 0);
out = await handleFantasy(cmd('fantasy', 'debug', {}, MOD), env, deps);
check('a mod gets the report, privately', out.flags === 64 && out.content.includes('**League**'));
check('defaulting to the first player on any team', seen[0] === 100);
await handleFantasy(cmd('fantasy', 'debug', { player: '101' }, MOD), env, deps);
check('or the one picked', seen[1] === 101);
out = await handleFantasy(cmd('fantasy', 'debug', { player: 'Marcus' }, MOD), env, deps);
check('a hand-typed name is refused', out.flags === 64 && out.content.includes('from the list') && seen.length === 2);
out = await handleFantasy(cmd('fantasy', 'debug', {}, MOD), {}, deps);
check('before setup, says so', out.content.includes('not been connected'));

const ac = (typed) => ({ data: { name: 'fantasy', options: [{ name: 'debug', options: [{ name: 'player', value: typed, focused: true }] }] }, member: MOD });
let c = await handleFantasyAutocomplete(ac(''), env, { fetchRosters: async () => rosters });
check('autocomplete offers players', c.map((x) => x.value).join() === '100,101');
c = await handleFantasyAutocomplete(ac('oka'), env, { fetchRosters: async () => rosters });
check('and filters them', c.length === 1 && c[0].name === 'Jules Okafor');

const fan = COMMANDS.find((x) => x.name === 'fantasy');
const dbg = fan.options.find((o) => o.name === 'debug');
check('/fantasy debug is registered with an optional player', dbg && dbg.options[0].required === false && dbg.options[0].autocomplete === true);
check('it is listed as mod-only', FANTASY_MOD_ONLY.join() === 'debug');
const html = readFileSync(new URL('../../docs/handbook.html', import.meta.url), 'utf8');
const row = html.slice(html.indexOf('/fantasy debug'), html.indexOf('<div class="cmd">', html.indexOf('/fantasy debug')));
check('the handbook marks it MOD', row.includes('class="mod"'));

if (fails.length) { console.log(`\n${fails.length} FAILED`); process.exit(1); }
console.log('\nall debug checks passed');
