import { scoreWeek, buildStandings } from './scoring.mjs';

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

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
