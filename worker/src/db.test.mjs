import {
  upsertGames, getGames, setResults, savePicks, getPicks, allPicks, openWeek,
  upsertTeams, getTeams, alreadyDone, markDone, awardPoints, seasonAwards,
  activeTournament, createTournament, tournamentEntrants, joinTournament,
  leaveTournament, startTournament, recordResult, closeTournament,
} from './db.mjs';

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
await setResults(db5, 2026, 1, [{ id: '1', winner: 'AAA', voided: false }]);
check('writes results', /UPDATE games/i.test(db5.statements[0].sql));
check('scopes the update to season and week, not just id',
  /WHERE id = \? AND season = \? AND week = \?/i.test(db5.statements[0].sql));
check('binds id, season and week in order', (() => {
  const binds = db5.statements[0].binds[0];
  return binds[2] === '1' && binds[3] === 2026 && binds[4] === 1;
})());

const db6 = fakeDb([{ week: 3 }]);
check('openWeek returns the week when one is found', await openWeek(db6, 2026) === 3);

const db7 = fakeDb([]);
check('openWeek returns null when the query yields no rows', await openWeek(db7, 2026) === null);

// --- teams ---
const dbT = fakeDb();
await upsertTeams(dbT, [
  { abbr: 'KC', name: 'Kansas City Chiefs', shortName: 'Chiefs', logo: 'https://x/kc.png', color: 'e31837', altColor: 'ffb81c' },
  { abbr: 'SEA', name: 'Seattle Seahawks', shortName: 'Seahawks', logo: 'https://x/sea.png', color: '002a5c', altColor: '69be28' },
]);
check('writes one statement per team', dbT.statements.length === 2);
check('upserts teams rather than failing on a repeat',
  dbT.statements.every((st) => /ON CONFLICT/i.test(st.sql)));
check('binds the abbreviation', dbT.statements[0].binds[0].includes('KC'));

const dbR = fakeDb([
  { abbr: 'KC', name: 'Kansas City Chiefs', short_name: 'Chiefs', logo: 'https://x/kc.png', color: 'e31837', alt_color: 'ffb81c' },
]);
const teamMap = await getTeams(dbR);
check('reads teams back keyed by abbreviation', teamMap.KC && teamMap.KC.name === 'Kansas City Chiefs');
check('maps snake_case columns to the shape the form expects',
  teamMap.KC.shortName === 'Chiefs' && teamMap.KC.altColor === 'ffb81c');

const dbEmpty = fakeDb([]);
check('an empty teams table yields an empty map', Object.keys(await getTeams(dbEmpty)).length === 0);

console.log('\n--- done markers ---');
// These gate the weekly job's two Discord posts. A false negative sends a
// duplicate @everyone; a false positive silently skips the post entirely.
const dbMarkMissing = fakeDb([]);
check('an unmarked key reads as not done', (await alreadyDone(dbMarkMissing, 'posted:2026:1')) === false);
check('the lookup is scoped to the key', dbMarkMissing.statements[0].binds[0].includes('posted:2026:1'));

const dbMarkPresent = fakeDb([{ value: '2026-09-15T09:00:00.000Z' }]);
check('a marked key reads as done', (await alreadyDone(dbMarkPresent, 'posted:2026:1')) === true);

const dbMarkWrite = fakeDb();
await markDone(dbMarkWrite, 'announced:2026', 'now');
check('marking writes one statement', dbMarkWrite.statements.length === 1);
check('marking binds key and value', dbMarkWrite.statements[0].binds[0].join('|') === 'announced:2026|now');
// Two runs racing on the same marker must not make the second one throw and
// take down a run that had otherwise succeeded.
check('marking twice is not an error', /ON CONFLICT\(key\) DO NOTHING/i.test(dbMarkWrite.statements[0].sql));

const dbMarkDefault = fakeDb();
await markDone(dbMarkDefault, 'posted:2026:2');
check('marking defaults the value to a timestamp',
  !Number.isNaN(Date.parse(dbMarkDefault.statements[0].binds[0][1])));

console.log('\n--- the points ledger ---');
const dbAward = fakeDb();
await awardPoints(dbAward, {
  season: 2026, userId: '555', amount: 10, reason: 'won the bracket',
  awardedBy: '999', now: '2026-09-13T00:00:00.000Z',
});
check('awarding writes one row', dbAward.statements.length === 1);
check('awarding inserts, never updates',
  /INSERT INTO points/i.test(dbAward.statements[0].sql) &&
  !/ON CONFLICT|UPDATE/i.test(dbAward.statements[0].sql));
check('the row carries who, what and why',
  dbAward.statements[0].binds[0].join('|') ===
    '2026|555|10|won the bracket|999|2026-09-13T00:00:00.000Z');

const dbAwardNow = fakeDb();
await awardPoints(dbAwardNow, { season: 2026, userId: '1', amount: 1, reason: 'r', awardedBy: '2' });
check('the timestamp defaults to now',
  !Number.isNaN(Date.parse(dbAwardNow.statements[0].binds[0][5])));

const dbTotals = fakeDb([{ user_id: '555', points: 30 }]);
const totals = await seasonAwards(dbTotals, 2026);
check('totals come back per person', totals.length === 1 && totals[0].userId === '555');
check('totals are numbers, not strings', totals[0].points === 30);
check('totals are summed in SQL', /SUM\(amount\)/i.test(dbTotals.statements[0].sql));
check('totals are scoped to the season', dbTotals.statements[0].binds[0].includes(2026));
check('an empty ledger reads as no awards', (await seasonAwards(fakeDb([]), 2026)).length === 0);

console.log('\n--- tournaments ---');
// Several of these return whether a conditional UPDATE actually matched, which
// the plain fake above cannot express — it always reports success with no row
// count, and "success" is exactly the wrong answer when the WHERE matched
// nothing.
function changingDb(changes, rows = []) {
  const statements = [];
  return {
    statements,
    prepare(sql) {
      const entry = { sql, binds: [] };
      statements.push(entry);
      const stmt = {
        bind(...args) { entry.binds.push(args); return stmt; },
        async run() { return { success: true, meta: { changes } }; },
        async all() { return { results: rows }; },
      };
      return stmt;
    },
  };
}

const row = {
  id: 't1', season: 2026, name: 'Winter Brawl', status: 'running',
  seeds: '["a","b","c"]', results: '[{"match":"W1-1","winner":"a"}]',
  channel_id: '123', created_by: '999', created_at: '2026-09-13T00:00:00.000Z',
};

const dbActive = fakeDb([row]);
const active = await activeTournament(dbActive, 2026);
check('the active tournament comes back shaped for the handler',
  active.id === 't1' && active.name === 'Winter Brawl');
check('the seed order is parsed, not left as text', Array.isArray(active.seeds) && active.seeds.length === 3);
check('the results are parsed too',
  Array.isArray(active.results) && active.results[0].match === 'W1-1');
check('the raw results text is kept for the compare-and-swap',
  active.resultsRaw === row.results);
check('only an open tournament counts as active',
  /status IN \('signup', 'running'\)/i.test(dbActive.statements[0].sql));
check('the newest one wins if somehow there are two',
  /ORDER BY created_at DESC LIMIT 1/i.test(dbActive.statements[0].sql));
check('nothing open reads as no tournament', (await activeTournament(fakeDb([]), 2026)) === null);

// A tournament that has not been drawn yet has no seeds at all, and a null
// there must not come back as the string "null" or crash the replay.
const dbSignup = fakeDb([{ ...row, status: 'signup', seeds: null, results: '[]' }]);
const signup = await activeTournament(dbSignup, 2026);
check('an undrawn tournament has no seeds', signup.seeds === null);
check('an undrawn tournament has an empty results list', signup.results.length === 0);

// Corrupt JSON in either column would otherwise throw inside a slash command,
// where the only thing the user sees is the interaction failing.
const dbJunk = fakeDb([{ ...row, seeds: 'not json', results: 'not json' }]);
const junk = await activeTournament(dbJunk, 2026);
check('unreadable seeds degrade to null rather than throwing', junk.seeds === null);
check('unreadable results degrade to empty rather than throwing', junk.results.length === 0);

const dbCreate = fakeDb();
await createTournament(dbCreate, {
  id: 't9', season: 2026, name: 'Winter Brawl', channelId: '123',
  createdBy: '999', now: '2026-09-13T00:00:00.000Z',
});
check('creating writes one row', dbCreate.statements.length === 1);
check('a new tournament opens for sign-ups', /'signup'/.test(dbCreate.statements[0].sql));
check('a new tournament starts with no results', /'\[\]'/.test(dbCreate.statements[0].sql));

const dbJoin = fakeDb();
await joinTournament(dbJoin, 't1', { userId: '555', displayName: 'Nando', now: 'now' });
check('joining twice does not create a second seat',
  /ON CONFLICT\(tournament_id, user_id\)/i.test(dbJoin.statements[0].sql));
check('joining again refreshes the stored display name',
  /DO UPDATE SET display_name = excluded.display_name/i.test(dbJoin.statements[0].sql));
check('the display name is stored at sign-up',
  dbJoin.statements[0].binds[0].includes('Nando'));

const dbEntrants = fakeDb([{ user_id: '555', display_name: 'Nando' }]);
const entered = await tournamentEntrants(dbEntrants, 't1');
check('entrants come back with their names',
  entered[0].userId === '555' && entered[0].displayName === 'Nando');
check('entrants are ordered by when they joined',
  /ORDER BY joined_at/i.test(dbEntrants.statements[0].sql));

check('leaving reports whether anyone was actually removed',
  (await leaveTournament(changingDb(1), 't1', '555')) === true);
check('leaving when you never joined reports false',
  (await leaveTournament(changingDb(0), 't1', '555')) === false);

const dbStart = changingDb(1);
check('starting a tournament that is open succeeds',
  (await startTournament(dbStart, 't1', ['a', 'b', 'c'])) === true);
check('starting only applies to one still in sign-ups',
  /status = 'signup'/i.test(dbStart.statements[0].sql));
check('the draw is stored as the seed order',
  dbStart.statements[0].binds[0][0] === '["a","b","c"]');
check('starting one already drawn reports false rather than redrawing it',
  (await startTournament(changingDb(0), 't1', ['a', 'b', 'c'])) === false);

// The whole point of this one: two people reporting sets at the same moment.
const dbResult = changingDb(1);
check('recording a result on unchanged data succeeds',
  (await recordResult(dbResult, 't1', '[]', [{ match: 'W1-1', winner: 'a' }])) === true);
check('the write is conditional on what was read',
  /WHERE id = \? AND results = \?/i.test(dbResult.statements[0].sql));
check('the previous text is what it compares against',
  dbResult.statements[0].binds[0][2] === '[]');
check('a result racing another one reports false instead of erasing it',
  (await recordResult(changingDb(0), 't1', '[]', [{ match: 'W1-1', winner: 'a' }])) === false);

const dbClose = fakeDb();
await closeTournament(dbClose, 't1', 'done');
check('closing sets the status it is given', dbClose.statements[0].binds[0][0] === 'done');

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
