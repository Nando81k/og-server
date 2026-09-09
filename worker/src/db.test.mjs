import { upsertGames, getGames, setResults, savePicks, getPicks, allPicks, openWeek } from './db.mjs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };

// Minimal D1 stand-in: records statements, returns queued rows.
function fakeDb(rows = []) {
  const statements = [];
  const batches = [];
  return {
    statements,
    batches,
    prepare(sql) {
      const entry = { sql, binds: [] };
      statements.push(entry);
      const stmt = {
        bind(...args) { entry.binds.push(args); return stmt; },
        async run() { return { success: true }; },
        async all() { return { results: rows }; },
      };
      return stmt;
    },
    async batch(list) { batches.push(list); return list; },
  };
}

const games = [
  { id: '1', kickoff: '2026-09-13T17:00Z', home: 'AAA', away: 'BBB', winner: null, voided: false },
  { id: '2', kickoff: '2026-09-13T20:00Z', home: 'CCC', away: 'DDD', winner: null, voided: false },
];

const db1 = fakeDb();
await upsertGames(db1, 2026, 1, games);
check('writes one statement per game', db1.statements.length === games.length);
check('upserts rather than inserts', db1.statements.every((s) => /ON CONFLICT/i.test(s.sql)));
check('binds the season and week', db1.statements[0].binds[0].includes(2026));

const db2 = fakeDb();
await savePicks(db2, { userId: '555', season: 2026, week: 1, picks: [
  { game_id: '1', team: 'AAA', confidence: 2 },
  { game_id: '2', team: 'DDD', confidence: 1 },
]});
check('clears the old week before writing', /DELETE/i.test(db2.statements[0].sql));
check('writes one row per pick', db2.statements.length === 3);
check('uses a single batch call, not loose .run()s', db2.batches.length === 1);
check('the batch carries all 3 statements', db2.batches[0]?.length === 3);

const db3 = fakeDb([{ game_id: '1', team: 'AAA', confidence: 2 }]);
const picks = await getPicks(db3, '555', 2026, 1);
check('reads picks back', picks.length === 1 && picks[0].team === 'AAA');

const db4 = fakeDb([{ id: '1', season: 2026, week: 1, kickoff: 'x', home: 'AAA', away: 'BBB', winner: null, voided: 0 }]);
const read = await getGames(db4, 2026, 1);
check('voided comes back as a boolean', read[0].voided === false);

const db5 = fakeDb();
await setResults(db5, [{ id: '1', winner: 'AAA', voided: false }]);
check('writes results', /UPDATE games/i.test(db5.statements[0].sql));

const db6 = fakeDb([{ week: 3 }]);
check('openWeek returns the week when one is found', await openWeek(db6, 2026) === 3);

const db7 = fakeDb([]);
check('openWeek returns null when the query yields no rows', await openWeek(db7, 2026) === null);

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
