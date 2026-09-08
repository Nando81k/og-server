import { readFileSync } from 'node:fs';
import { parseScoreboard } from './espn.mjs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };
const load = (n) => JSON.parse(readFileSync(new URL(`../test/fixtures/${n}`, import.meta.url)));

const done = parseScoreboard(load('week-complete.json'));
check('reads the season', done.season === 2025);
check('reads the week', done.week === 1);
check('reads every game', done.games.length === 16);
check('all games completed', done.games.every((g) => g.completed));
check('every completed game has a winner or is voided',
  done.games.every((g) => g.winner !== null || g.voided));
check('winner is a team in the game',
  done.games.every((g) => !g.winner || g.winner === g.home || g.winner === g.away));
check('kickoff is ISO', done.games.every((g) => !Number.isNaN(Date.parse(g.kickoff))));
check('ids are strings', done.games.every((g) => typeof g.id === 'string' && g.id.length > 0));

const pre = parseScoreboard(load('week-pre.json'));
check('unplayed games are not completed', pre.games.every((g) => !g.completed));
check('unplayed games have no winner', pre.games.every((g) => g.winner === null));
check('unplayed games are not voided', pre.games.every((g) => !g.voided));

// A tie: completed, but nobody flagged as winner.
const tie = parseScoreboard({
  season: { year: 2025 }, week: { number: 9 },
  events: [{ id: '1', date: '2025-11-02T18:00Z', competitions: [{
    status: { type: { completed: true, state: 'post' } },
    competitors: [
      { homeAway: 'home', team: { abbreviation: 'NYG' }, winner: false },
      { homeAway: 'away', team: { abbreviation: 'PHI' }, winner: false },
    ] }] }],
});
check('a tie is voided', tie.games[0].voided === true);
check('a tie has no winner', tie.games[0].winner === null);

// Validation tests
const checkThrows = (label, fn, expectedMsg) => {
  try {
    fn();
    check(label, false);
  } catch (e) {
    check(label, e.message.includes(expectedMsg));
  }
};

checkThrows('event missing competitions array throws with event id',
  () => parseScoreboard({
    season: { year: 2025 }, week: { number: 1 },
    events: [{ id: '401772510', date: '2025-09-04T20:20Z', competitions: [] }],
  }),
  'Malformed event 401772510');

checkThrows('event missing home competitor throws with event id',
  () => parseScoreboard({
    season: { year: 2025 }, week: { number: 1 },
    events: [{
      id: '401772511',
      date: '2025-09-04T20:20Z',
      competitions: [{
        status: { type: { completed: false } },
        competitors: [
          { homeAway: 'away', team: { abbreviation: 'KC' }, winner: false },
        ]
      }],
    }],
  }),
  'Malformed event 401772511');

checkThrows('payload with no season throws',
  () => parseScoreboard({
    week: { number: 1 },
    events: [],
  }),
  'missing season');

checkThrows('payload with no week throws',
  () => parseScoreboard({
    season: { year: 2025 },
    events: [],
  }),
  'missing week');

const empty = parseScoreboard({
  season: { year: 2026 }, week: { number: 1 }, events: []
});
check('empty events returns valid object',
  empty.season === 2026 && empty.week === 1 && empty.games.length === 0);

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
