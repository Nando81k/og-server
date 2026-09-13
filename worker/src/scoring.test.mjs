import { scoreWeek, buildStandings, mergeAwards, scoreSeason } from './scoring.mjs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };

const g = (id, winner, voided = false) =>
  ({ id, home: 'AAA', away: 'BBB', winner, completed: true, voided, kickoff: '2026-09-13T17:00Z' });

const games = [g('1', 'AAA'), g('2', 'BBB'), g('3', 'AAA'), g('4', null, true)];

check('awards confidence for a correct pick',
  scoreWeek({ games, picks: [{ game_id: '1', team: 'AAA', confidence: 4 }] }).points === 4);
check('awards nothing for a wrong pick',
  scoreWeek({ games, picks: [{ game_id: '1', team: 'BBB', confidence: 4 }] }).points === 0);

const full = scoreWeek({ games, picks: [
  { game_id: '1', team: 'AAA', confidence: 4 },
  { game_id: '2', team: 'AAA', confidence: 3 },
  { game_id: '3', team: 'AAA', confidence: 2 },
  { game_id: '4', team: 'AAA', confidence: 1 },
]});
check('sums only the correct picks', full.points === 6);
check('counts correct picks', full.correct === 2);
check('a voided game pays nobody', full.points === 4 + 2);
check('possible excludes the voided game', full.possible === 4 + 3 + 2);

check('no picks scores zero', scoreWeek({ games, picks: [] }).points === 0);
check('a pick for a game not in the week is ignored',
  scoreWeek({ games, picks: [{ game_id: '99', team: 'AAA', confidence: 9 }] }).points === 0);
check('an unfinished game pays nothing',
  scoreWeek({ games: [{ id: '5', winner: null, completed: false, voided: false }],
    picks: [{ game_id: '5', team: 'AAA', confidence: 5 }] }).points === 0);

const table = buildStandings([
  { userId: 'a', points: 100, correct: 10, week: 1 },
  { userId: 'b', points: 120, correct: 9, week: 1 },
  { userId: 'a', points: 90, correct: 8, week: 2 },
  { userId: 'c', points: 120, correct: 9, week: 1 },
]);
check('sums across weeks', table.find((r) => r.userId === 'a').points === 190);
check('sorts by points', table[0].userId === 'a');
check('counts weeks entered', table.find((r) => r.userId === 'a').weeks === 2);
check('ties break by userId', table[1].userId === 'b' && table[2].userId === 'c');

console.log('\n--- hand-awarded points join the standings ---');
const picks = buildStandings([
  { userId: 'a', points: 10, correct: 5, week: 1 },
  { userId: 'b', points: 6, correct: 3, week: 1 },
]);

const merged = mergeAwards(picks, [{ userId: 'b', points: 20 }]);
check('an award is added to an existing total',
  merged.find((r) => r.userId === 'b').points === 26);
check('someone with no award is untouched',
  merged.find((r) => r.userId === 'a').points === 10);
check('the board re-sorts after awarding', merged[0].userId === 'b');

// The whole reason this is separate from buildStandings. A tournament win is
// not a week of pick'em entered, and "entered every week" reads that count.
check('an award does not count as a week entered',
  merged.find((r) => r.userId === 'b').weeks === 1);
check('an award does not count as a correct pick',
  merged.find((r) => r.userId === 'b').correct === 3);

const newcomer = mergeAwards(picks, [{ userId: 'c', points: 15 }]);
check('someone with awards but no picks still appears',
  newcomer.find((r) => r.userId === 'c').points === 15);
check('a newcomer has entered no weeks',
  newcomer.find((r) => r.userId === 'c').weeks === 0);
check('a newcomer has no correct picks',
  newcomer.find((r) => r.userId === 'c').correct === 0);

check('a negative award subtracts',
  mergeAwards(picks, [{ userId: 'a', points: -4 }]).find((r) => r.userId === 'a').points === 6);
check('two awards to one person both land',
  mergeAwards(picks, [{ userId: 'a', points: 5 }, { userId: 'a', points: 5 }])
    .find((r) => r.userId === 'a').points === 20);

check('no awards leaves the board alone',
  JSON.stringify(mergeAwards(picks, [])) === JSON.stringify(picks));
check('missing awards leave the board alone',
  JSON.stringify(mergeAwards(picks, undefined)) === JSON.stringify(picks));
check('awards alone still build a board',
  mergeAwards([], [{ userId: 'z', points: 3 }])[0].userId === 'z');
check('survives both being empty', mergeAwards([], []).length === 0);
// Merging must not edit the rows buildStandings returned.
check('the original standings are not mutated',
  picks.find((r) => r.userId === 'b').points === 6);

console.log('\n--- scoring a whole season ---');
// Shared by the weekly job and /leaderboard so the two can never disagree
// about someone's total.
const won = (id, winner) => ({ id, winner, completed: true, voided: false });
const pick = (userId, game_id, team, confidence) => ({ userId, game_id, team, confidence });

const season = scoreSeason([
  { week: 1, games: [won('a', 'KC')], picks: [pick('u1', 'a', 'KC', 1), pick('u2', 'a', 'BAL', 1)] },
  { week: 2, games: [won('b', 'SF')], picks: [pick('u1', 'b', 'SF', 2)] },
]);
check('every week with games counts as played', season.weeksPlayed === 2);
check('a row per person per week', season.rows.length === 3);
check('a correct pick scores its confidence',
  season.rows.find((r) => r.userId === 'u1' && r.week === 2).points === 2);
check('a wrong pick scores nothing',
  season.rows.find((r) => r.userId === 'u2').points === 0);

// A season bootstrapped at week 3 has earlier weeks that never existed, and
// counting them would make "entered every week" unreachable for everyone.
const sparse = scoreSeason([
  { week: 1, games: [], picks: [] },
  { week: 2, games: [won('c', 'KC')], picks: [pick('u1', 'c', 'KC', 1)] },
]);
check('an empty week is not counted as played', sparse.weeksPlayed === 1);
check('an empty week contributes no rows', sparse.rows.length === 1);

check('a week with games but no picks still counts as played',
  scoreSeason([{ week: 1, games: [won('d', 'KC')], picks: [] }]).weeksPlayed === 1);
check('missing picks do not throw',
  scoreSeason([{ week: 1, games: [won('d', 'KC')] }]).rows.length === 0);
check('an empty season is empty',
  scoreSeason([]).weeksPlayed === 0 && scoreSeason([]).rows.length === 0);
check('no argument is survivable', scoreSeason().weeksPlayed === 0);
check('it feeds buildStandings directly',
  buildStandings(season.rows).find((r) => r.userId === 'u1').points === 3);

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
