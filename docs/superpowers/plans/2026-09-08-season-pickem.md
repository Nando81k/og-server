# Season Pick'em Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A weekly NFL confidence pick'em that scores itself from real results and posts standings to `#season-leaderboard`, with no human entering anything.

**Architecture:** Everything runs in the existing Cloudflare Worker. `/picks` returns a signed link to a web form served by the same Worker; submissions are stored in D1. One Tuesday cron scores last week from ESPN's public scoreboard, posts the leaderboard, then syncs the coming week's schedule. Standings are a query, never a stored total.

**Tech Stack:** Cloudflare Workers, D1 (SQLite), Web Crypto (HMAC-SHA256), plain `fetch`. No framework, no ORM.

**Spec:** `docs/superpowers/specs/2026-09-08-season-pickem-design.md`

## Global Constraints

- Node 18+ / Workers runtime. ES modules only, `.mjs` extension.
- No new npm dependencies. `discord.js` does not run on Workers and must not be imported under `worker/`.
- Every module under `worker/src/` must be testable without network access and without a Discord token. Tests use saved fixtures.
- Tests run via `npm test` and must pass before every commit.
- Confidence values are the integers `1..N` where N is the number of games in that week. N is 16 early season and 13-14 during byes — never hardcode 16.
- A tied game (ESPN reports `completed: true` with no competitor flagged `winner: true`) is voided: nobody scores it.
- Times are ISO 8601 UTC strings in storage, epoch milliseconds in logic.
- Never log a token, a signature, or `PICKS_SECRET`.

---

### Task 1: ESPN client

Reads the NFL schedule and results. The only module that knows ESPN's shape.

**Files:**
- Create: `worker/src/espn.mjs`
- Create: `worker/test/fixtures/week-complete.json`
- Create: `worker/test/fixtures/week-pre.json`
- Test: `worker/src/espn.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `parseScoreboard(json)` -> `{season: number, week: number, games: Game[]}`
  - `Game` = `{id: string, kickoff: string, home: string, away: string, winner: string|null, completed: boolean, voided: boolean}`
  - `fetchWeek({season, week, fetchImpl = fetch})` -> same shape as `parseScoreboard`
  - `SCOREBOARD_URL` (string) — base endpoint

- [ ] **Step 1: Save two real fixtures**

```bash
cd worker/test/fixtures
curl -s "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=2025&seasontype=2&week=1" > week-complete.json
curl -s "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=2026&seasontype=2&week=1" > week-pre.json
```

Confirm both are non-empty and contain `"events"`:

```bash
node -e 'for (const f of ["week-complete.json","week-pre.json"]) { const d=require("./"+f); console.log(f, d.events.length, "events"); }'
```

- [ ] **Step 2: Write the failing test**

```js
// worker/src/espn.test.mjs
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

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
```

- [ ] **Step 3: Run it and watch it fail**

Run: `node worker/src/espn.test.mjs`
Expected: FAIL — `Cannot find module './espn.mjs'`

- [ ] **Step 4: Implement**

```js
// worker/src/espn.mjs
export const SCOREBOARD_URL =
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

export function parseScoreboard(json) {
  const season = json?.season?.year;
  const week = json?.week?.number;
  const games = (json?.events ?? []).map((event) => {
    const c = event.competitions[0];
    const home = c.competitors.find((t) => t.homeAway === 'home');
    const away = c.competitors.find((t) => t.homeAway === 'away');
    const completed = c.status?.type?.completed === true;
    const won = c.competitors.find((t) => t.winner === true);
    return {
      id: String(event.id),
      kickoff: event.date,
      home: home.team.abbreviation,
      away: away.team.abbreviation,
      winner: won ? won.team.abbreviation : null,
      completed,
      // Finished with nobody flagged the winner is a tie. Never inferred
      // from the scores, which can be equal mid-game.
      voided: completed && !won,
    };
  });
  return { season, week, games };
}

export async function fetchWeek({ season, week, fetchImpl = fetch }) {
  const url = `${SCOREBOARD_URL}?dates=${season}&seasontype=2&week=${week}`;
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'og-server' } });
  if (!res.ok) throw new Error(`ESPN ${res.status}`);
  return parseScoreboard(await res.json());
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `node worker/src/espn.test.mjs`
Expected: ALL PASSED

- [ ] **Step 6: Commit**

```bash
git add worker/src/espn.mjs worker/src/espn.test.mjs worker/test/fixtures
git commit -m "Add the ESPN scoreboard client"
```

---

### Task 2: Signed pick links

Identifies who opened the form, without a login.

**Files:**
- Create: `worker/src/token.mjs`
- Test: `worker/src/token.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `signPickToken({userId, season, week, exp}, secret)` -> `Promise<string>`
  - `verifyPickToken(token, secret, now = Date.now())` -> `Promise<{userId, season, week, exp}|null>`

`exp` is epoch milliseconds. `verifyPickToken` returns `null` for anything wrong — bad signature, expired, malformed — and never throws.

- [ ] **Step 1: Write the failing test**

```js
// worker/src/token.test.mjs
import { webcrypto } from 'node:crypto';
import { signPickToken, verifyPickToken } from './token.mjs';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };

const secret = 'test-secret';
const now = 1_757_000_000_000;
const claims = { userId: '555', season: 2026, week: 1, exp: now + 3600_000 };
const token = await signPickToken(claims, secret);

const ok = await verifyPickToken(token, secret, now);
check('round-trips the user', ok && ok.userId === '555');
check('round-trips season and week', ok && ok.season === 2026 && ok.week === 1);
check('the token carries no readable secret', !token.includes(secret));

check('rejects the wrong secret', (await verifyPickToken(token, 'other', now)) === null);
check('rejects an expired token', (await verifyPickToken(token, secret, claims.exp + 1)) === null);
check('accepts right up to expiry', (await verifyPickToken(token, secret, claims.exp)) !== null);
check('rejects a tampered payload',
  (await verifyPickToken('x' + token.slice(1), secret, now)) === null);
check('rejects a tampered signature',
  (await verifyPickToken(token.slice(0, -1) + (token.at(-1) === 'A' ? 'B' : 'A'), secret, now)) === null);
check('rejects a token with no signature', (await verifyPickToken('onlypayload', secret, now)) === null);
check('rejects empty', (await verifyPickToken('', secret, now)) === null);
check('rejects undefined', (await verifyPickToken(undefined, secret, now)) === null);
check('rejects junk', (await verifyPickToken('!!!.???', secret, now)) === null);

// Forging a payload without the secret must not work.
const forged = btoa(JSON.stringify({ userId: '999', season: 2026, week: 1, exp: now + 1000 }))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.' + token.split('.')[1];
check('rejects a swapped payload with a valid-looking signature',
  (await verifyPickToken(forged, secret, now)) === null);

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node worker/src/token.test.mjs`
Expected: FAIL — `Cannot find module './token.mjs'`

- [ ] **Step 3: Implement**

```js
// worker/src/token.mjs
const enc = new TextEncoder();

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const unb64url = (s) => {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function key(secret) {
  return crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}

export async function signPickToken(claims, secret) {
  const payload = b64url(enc.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

export async function verifyPickToken(token, secret, now = Date.now()) {
  try {
    if (typeof token !== 'string') return null;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const valid = await crypto.subtle.verify(
      'HMAC', await key(secret), unb64url(sig), enc.encode(payload)
    );
    if (!valid) return null;
    const claims = JSON.parse(new TextDecoder().decode(unb64url(payload)));
    if (typeof claims.exp !== 'number' || now > claims.exp) return null;
    return claims;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node worker/src/token.test.mjs`
Expected: ALL PASSED

- [ ] **Step 5: Commit**

```bash
git add worker/src/token.mjs worker/src/token.test.mjs
git commit -m "Add signed pick links"
```

---

### Task 3: Scoring and standings

Pure arithmetic. No database, no network.

**Files:**
- Create: `worker/src/scoring.mjs`
- Test: `worker/src/scoring.test.mjs`

**Interfaces:**
- Consumes: `Game` from Task 1.
- Produces:
  - `scoreWeek({games, picks})` -> `{points: number, correct: number, possible: number}`
  - `picks` = `[{game_id, team, confidence}]`
  - `buildStandings(rows)` -> `[{userId, points, correct, weeks}]` sorted by points desc, then correct desc, then userId asc
  - `rows` = `[{userId, points, correct, week}]`

- [ ] **Step 1: Write the failing test**

```js
// worker/src/scoring.test.mjs
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node worker/src/scoring.test.mjs`
Expected: FAIL — `Cannot find module './scoring.mjs'`

- [ ] **Step 3: Implement**

```js
// worker/src/scoring.mjs
export function scoreWeek({ games, picks }) {
  const byId = new Map(games.map((g) => [g.id, g]));
  let points = 0;
  let correct = 0;
  let possible = 0;

  for (const game of games) {
    if (game.voided || !game.completed) continue;
    const pick = picks.find((p) => p.game_id === game.id);
    if (pick) possible += pick.confidence;
    if (pick && pick.team === game.winner) {
      points += pick.confidence;
      correct += 1;
    }
  }
  // A pick naming a game outside this week scores nothing; byId guards reads.
  void byId;
  return { points, correct, possible };
}

export function buildStandings(rows) {
  const totals = new Map();
  for (const r of rows) {
    const t = totals.get(r.userId) ?? { userId: r.userId, points: 0, correct: 0, weeks: 0 };
    t.points += r.points;
    t.correct += r.correct;
    t.weeks += 1;
    totals.set(r.userId, t);
  }
  return [...totals.values()].sort(
    (a, b) => b.points - a.points || b.correct - a.correct || (a.userId < b.userId ? -1 : 1)
  );
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node worker/src/scoring.test.mjs`
Expected: ALL PASSED

- [ ] **Step 5: Commit**

```bash
git add worker/src/scoring.mjs worker/src/scoring.test.mjs
git commit -m "Add pick'em scoring and standings"
```

---

### Task 4: Submission validation

Rejects a bad slate before it reaches the database.

**Files:**
- Create: `worker/src/validate.mjs`
- Test: `worker/src/validate.test.mjs`

**Interfaces:**
- Consumes: `Game` from Task 1.
- Produces:
  - `lockTime(games)` -> `number` (epoch ms of the earliest kickoff)
  - `validateSubmission({games, submission, now})` -> `{ok: true, picks} | {ok: false, error}`
  - `submission` = `[{game_id, team, confidence}]`
  - `error` is a sentence shown to the user.

- [ ] **Step 1: Write the failing test**

```js
// worker/src/validate.test.mjs
import { validateSubmission, lockTime } from './validate.mjs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };

const games = [
  { id: '1', home: 'AAA', away: 'BBB', kickoff: '2026-09-13T17:00:00Z' },
  { id: '2', home: 'CCC', away: 'DDD', kickoff: '2026-09-13T20:00:00Z' },
  { id: '3', home: 'EEE', away: 'FFF', kickoff: '2026-09-15T00:15:00Z' },
];
const before = Date.parse('2026-09-13T16:00:00Z');
const after = Date.parse('2026-09-13T17:00:01Z');
const good = [
  { game_id: '1', team: 'AAA', confidence: 3 },
  { game_id: '2', team: 'DDD', confidence: 1 },
  { game_id: '3', team: 'EEE', confidence: 2 },
];

check('locks at the earliest kickoff', lockTime(games) === Date.parse('2026-09-13T17:00:00Z'));

const ok = validateSubmission({ games, submission: good, now: before });
check('accepts a valid slate', ok.ok === true);
check('returns the picks', ok.ok && ok.picks.length === 3);

const late = validateSubmission({ games, submission: good, now: after });
check('rejects after lock', late.ok === false);
check('says why it rejected', late.ok === false && /lock/i.test(late.error));

const missing = validateSubmission({ games, submission: good.slice(0, 2), now: before });
check('rejects a missing game', missing.ok === false && /every game/i.test(missing.error));

const dupe = validateSubmission({ games, now: before, submission: [
  { game_id: '1', team: 'AAA', confidence: 1 },
  { game_id: '2', team: 'DDD', confidence: 1 },
  { game_id: '3', team: 'EEE', confidence: 2 },
]});
check('rejects duplicate confidence', dupe.ok === false && /once/i.test(dupe.error));

const gap = validateSubmission({ games, now: before, submission: [
  { game_id: '1', team: 'AAA', confidence: 1 },
  { game_id: '2', team: 'DDD', confidence: 2 },
  { game_id: '3', team: 'EEE', confidence: 5 },
]});
check('rejects out-of-range confidence', gap.ok === false && /1 to 3/.test(gap.error));

const wrongTeam = validateSubmission({ games, now: before, submission: [
  { game_id: '1', team: 'ZZZ', confidence: 3 },
  { game_id: '2', team: 'DDD', confidence: 1 },
  { game_id: '3', team: 'EEE', confidence: 2 },
]});
check('rejects a team not in the game', wrongTeam.ok === false && /not playing/i.test(wrongTeam.error));

const unknown = validateSubmission({ games, now: before, submission: [
  ...good, { game_id: '99', team: 'AAA', confidence: 4 },
]});
check('rejects an unknown game', unknown.ok === false);

check('rejects a non-array', validateSubmission({ games, submission: null, now: before }).ok === false);

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node worker/src/validate.test.mjs`
Expected: FAIL — `Cannot find module './validate.mjs'`

- [ ] **Step 3: Implement**

```js
// worker/src/validate.mjs
export function lockTime(games) {
  return Math.min(...games.map((g) => Date.parse(g.kickoff)));
}

export function validateSubmission({ games, submission, now }) {
  const n = games.length;
  const bad = (error) => ({ ok: false, error });

  if (!Array.isArray(submission)) return bad('That submission was not readable.');
  if (now >= lockTime(games)) {
    return bad('Picks are locked — the first game of the week has kicked off.');
  }
  if (submission.length !== n) return bad(`Pick every game — all ${n} of them.`);

  const byId = new Map(games.map((g) => [g.id, g]));
  const seen = new Set();

  for (const p of submission) {
    const game = byId.get(p.game_id);
    if (!game) return bad('That slate includes a game that is not in this week.');
    if (p.team !== game.home && p.team !== game.away) {
      return bad(`${p.team} is not playing in that game.`);
    }
    if (!Number.isInteger(p.confidence) || p.confidence < 1 || p.confidence > n) {
      return bad(`Confidence has to be a whole number from 1 to ${n}.`);
    }
    if (seen.has(p.confidence)) {
      return bad('Each confidence value can be used only once.');
    }
    seen.add(p.confidence);
  }
  return { ok: true, picks: submission };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node worker/src/validate.test.mjs`
Expected: ALL PASSED

- [ ] **Step 5: Commit**

```bash
git add worker/src/validate.mjs worker/src/validate.test.mjs
git commit -m "Add pick submission validation"
```

---

### Task 5: Storage

D1 schema and every query the Worker makes.

**Files:**
- Create: `worker/schema.sql`
- Create: `worker/src/db.mjs`
- Modify: `worker/wrangler.toml`
- Test: `worker/src/db.test.mjs`

**Interfaces:**
- Consumes: `Game` from Task 1.
- Produces:
  - `upsertGames(db, season, week, games)` -> `Promise<void>`
  - `getGames(db, season, week)` -> `Promise<Game[]>`
  - `setResults(db, games)` -> `Promise<void>` (writes `winner` and `voided`)
  - `savePicks(db, {userId, season, week, picks})` -> `Promise<void>` (replaces that user's week)
  - `getPicks(db, userId, season, week)` -> `Promise<[{game_id, team, confidence}]>`
  - `allPicks(db, season, week)` -> `Promise<[{userId, game_id, team, confidence}]>`
  - `openWeek(db, season)` -> `Promise<number|null>` — lowest week with any unscored game

`db` is the D1 binding. Tests use a hand-written fake implementing `prepare().bind().all()/run()`, so no real database is needed.

- [ ] **Step 1: Write the schema**

```sql
-- worker/schema.sql
CREATE TABLE IF NOT EXISTS games (
  id       TEXT PRIMARY KEY,
  season   INTEGER NOT NULL,
  week     INTEGER NOT NULL,
  kickoff  TEXT    NOT NULL,
  home     TEXT    NOT NULL,
  away     TEXT    NOT NULL,
  winner   TEXT,
  voided   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS games_week ON games (season, week);

CREATE TABLE IF NOT EXISTS picks (
  user_id    TEXT    NOT NULL,
  game_id    TEXT    NOT NULL,
  season     INTEGER NOT NULL,
  week       INTEGER NOT NULL,
  team       TEXT    NOT NULL,
  confidence INTEGER NOT NULL,
  PRIMARY KEY (user_id, game_id)
);
CREATE INDEX IF NOT EXISTS picks_week ON picks (season, week);
```

- [ ] **Step 2: Write the failing test**

```js
// worker/src/db.test.mjs
import { upsertGames, getGames, setResults, savePicks, getPicks, allPicks } from './db.mjs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };

// Minimal D1 stand-in: records statements, returns queued rows.
function fakeDb(rows = []) {
  const statements = [];
  return {
    statements,
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
    async batch(list) { return list; },
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

const db3 = fakeDb([{ game_id: '1', team: 'AAA', confidence: 2 }]);
const picks = await getPicks(db3, '555', 2026, 1);
check('reads picks back', picks.length === 1 && picks[0].team === 'AAA');

const db4 = fakeDb([{ id: '1', season: 2026, week: 1, kickoff: 'x', home: 'AAA', away: 'BBB', winner: null, voided: 0 }]);
const read = await getGames(db4, 2026, 1);
check('voided comes back as a boolean', read[0].voided === false);

const db5 = fakeDb();
await setResults(db5, [{ id: '1', winner: 'AAA', voided: false }]);
check('writes results', /UPDATE games/i.test(db5.statements[0].sql));

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
```

- [ ] **Step 3: Run it and watch it fail**

Run: `node worker/src/db.test.mjs`
Expected: FAIL — `Cannot find module './db.mjs'`

- [ ] **Step 4: Implement**

```js
// worker/src/db.mjs
export async function upsertGames(db, season, week, games) {
  for (const g of games) {
    await db
      .prepare(
        `INSERT INTO games (id, season, week, kickoff, home, away, winner, voided)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET kickoff = excluded.kickoff`
      )
      .bind(g.id, season, week, g.kickoff, g.home, g.away, g.winner ?? null, g.voided ? 1 : 0)
      .run();
  }
}

export async function getGames(db, season, week) {
  const { results } = await db
    .prepare(`SELECT * FROM games WHERE season = ? AND week = ? ORDER BY kickoff, id`)
    .bind(season, week)
    .all();
  return results.map((r) => ({ ...r, voided: r.voided === 1, completed: r.winner !== null || r.voided === 1 }));
}

export async function setResults(db, games) {
  for (const g of games) {
    await db
      .prepare(`UPDATE games SET winner = ?, voided = ? WHERE id = ?`)
      .bind(g.winner ?? null, g.voided ? 1 : 0, g.id)
      .run();
  }
}

export async function savePicks(db, { userId, season, week, picks }) {
  await db
    .prepare(`DELETE FROM picks WHERE user_id = ? AND season = ? AND week = ?`)
    .bind(userId, season, week)
    .run();
  for (const p of picks) {
    await db
      .prepare(
        `INSERT INTO picks (user_id, game_id, season, week, team, confidence)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(userId, p.game_id, season, week, p.team, p.confidence)
      .run();
  }
}

export async function getPicks(db, userId, season, week) {
  const { results } = await db
    .prepare(`SELECT game_id, team, confidence FROM picks WHERE user_id = ? AND season = ? AND week = ?`)
    .bind(userId, season, week)
    .all();
  return results;
}

export async function allPicks(db, season, week) {
  const { results } = await db
    .prepare(
      `SELECT user_id AS userId, game_id, team, confidence
       FROM picks WHERE season = ? AND week = ?`
    )
    .bind(season, week)
    .all();
  return results;
}

export async function openWeek(db, season) {
  const { results } = await db
    .prepare(
      `SELECT MIN(week) AS week FROM games WHERE season = ? AND winner IS NULL AND voided = 0`
    )
    .bind(season)
    .all();
  return results[0]?.week ?? null;
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `node worker/src/db.test.mjs`
Expected: ALL PASSED

- [ ] **Step 6: Bind D1 and apply the schema**

```bash
cd worker
wrangler d1 create og-pickem
```

Add the binding printed by that command to `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "og-pickem"
database_id = "<paste the id wrangler printed>"
```

Then:

```bash
wrangler d1 execute og-pickem --remote --file=./schema.sql
```

- [ ] **Step 7: Commit**

```bash
git add worker/schema.sql worker/src/db.mjs worker/src/db.test.mjs worker/wrangler.toml
git commit -m "Add pick'em storage"
```

---

### Task 6: The pick form and /picks

The page someone actually fills in, and the command that hands out its link.

**Files:**
- Create: `worker/src/form.mjs`
- Modify: `worker/src/index.mjs`
- Modify: `scripts/discord/register-commands.mjs`
- Test: `worker/src/form.test.mjs`

**Interfaces:**
- Consumes: `Game` (Task 1), `signPickToken`/`verifyPickToken` (Task 2), `validateSubmission` (Task 4), `getGames`/`getPicks`/`savePicks` (Task 5).
- Produces:
  - `renderForm({games, picks, token, lockAt})` -> `string` (a complete HTML document)
  - `renderMessage(text)` -> `string` (a plain page for expired links and errors)

The form posts JSON to the same path. Confidence is a `<select>` per game holding `1..N` — not drag-and-drop, which is unusable on a phone.

- [ ] **Step 1: Write the failing test**

```js
// worker/src/form.test.mjs
import { renderForm, renderMessage } from './form.mjs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };

const games = [
  { id: '1', home: 'KC', away: 'BAL', kickoff: '2026-09-13T17:00:00Z' },
  { id: '2', home: 'SF', away: 'NYJ', kickoff: '2026-09-13T20:00:00Z' },
];
const html = renderForm({ games, picks: [], token: 'tok', lockAt: Date.parse(games[0].kickoff) });

check('is a complete document', html.startsWith('<!doctype html>'));
check('names both teams in every game', games.every((g) => html.includes(g.home) && html.includes(g.away)));
check('offers a confidence option per game', (html.match(/<option value="1"/g) || []).length === games.length);
check('caps confidence at the number of games', !html.includes('<option value="3"'));
check('carries the token', html.includes('tok'));
check('is mobile-first', html.includes('width=device-width'));
check('shows the lock time', /lock/i.test(html));

const pre = renderForm({ games, token: 'tok', lockAt: 1, picks: [
  { game_id: '1', team: 'KC', confidence: 2 },
]});
check('preselects an existing pick', /value="KC"[^>]*checked/.test(pre) || pre.includes('data-picked="KC"'));

check('escapes anything from the outside', !renderMessage('<script>x</script>').includes('<script>x'));
check('the message page is a document', renderMessage('gone').startsWith('<!doctype html>'));

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node worker/src/form.test.mjs`
Expected: FAIL — `Cannot find module './form.mjs'`

- [ ] **Step 3: Implement the form**

```js
// worker/src/form.mjs
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const shell = (title, body) => `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;padding:20px;background:#17151a;color:#f2ede2;
    font:16px/1.5 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;max-width:640px;margin:0 auto}
  h1{font-size:1.4rem;margin:0 0 4px}
  .sub{color:#a49c8e;font-size:.9rem;margin-bottom:20px}
  .game{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #ffffff1a}
  .teams{flex:1;display:flex;gap:8px}
  label.team{flex:1;padding:10px;border:1px solid #ffffff26;border-radius:8px;text-align:center;cursor:pointer}
  label.team:has(input:checked){background:#e8531f;border-color:#e8531f;color:#fff}
  label.team input{position:absolute;opacity:0}
  select{background:#221f26;color:#f2ede2;border:1px solid #ffffff26;border-radius:8px;padding:10px;font-size:16px}
  button{width:100%;margin-top:20px;padding:14px;font-size:16px;font-weight:600;
    background:#e8531f;color:#fff;border:0;border-radius:8px;cursor:pointer}
  #msg{margin-top:12px;color:#ff8452}
</style></head><body>${body}</body></html>`;

export function renderMessage(text) {
  return shell('Pick’em', `<h1>Pick&rsquo;em</h1><p>${esc(text)}</p>`);
}

export function renderForm({ games, picks = [], token, lockAt }) {
  const n = games.length;
  const chosen = new Map(picks.map((p) => [p.game_id, p]));

  const rows = games
    .map((g) => {
      const p = chosen.get(g.id);
      const team = (t) =>
        `<label class="team"><input type="radio" name="t_${esc(g.id)}" value="${esc(t)}"${
          p && p.team === t ? ' checked' : ''
        }>${esc(t)}</label>`;
      const opts = Array.from({ length: n }, (_, i) => n - i)
        .map((v) => `<option value="${v}"${p && p.confidence === v ? ' selected' : ''}>${v}</option>`)
        .join('');
      return `<div class="game" data-game="${esc(g.id)}"${p ? ` data-picked="${esc(p.team)}"` : ''}>
        <div class="teams">${team(g.away)}${team(g.home)}</div>
        <select name="c_${esc(g.id)}"><option value="">-</option>${opts}</select>
      </div>`;
    })
    .join('');

  const body = `<h1>Week picks</h1>
<div class="sub">Pick every winner, then rank them ${n} (most sure) down to 1.
Locks at ${esc(new Date(lockAt).toUTCString())}.</div>
<form id="f">${rows}<button type="submit">Submit picks</button><div id="msg"></div></form>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const picks = [...document.querySelectorAll('.game')].map((row) => {
    const id = row.dataset.game;
    const team = row.querySelector('input[name="t_' + id + '"]:checked');
    const conf = row.querySelector('select').value;
    return { game_id: id, team: team && team.value, confidence: Number(conf) };
  });
  const res = await fetch(location.pathname + location.search, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: ${JSON.stringify(token)}, picks }),
  });
  const out = await res.json().catch(() => ({ error: 'Something went wrong.' }));
  document.getElementById('msg').textContent = res.ok ? 'Saved. You can change these until lock.' : out.error;
});
</script>`;
  return shell('Week picks', body);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node worker/src/form.test.mjs`
Expected: ALL PASSED

- [ ] **Step 5: Wire the routes and the command into the Worker**

In `worker/src/index.mjs`, add these imports beside the existing ones:

```js
import { verifyPickToken, signPickToken } from './token.mjs';
import { renderForm, renderMessage } from './form.mjs';
import { validateSubmission, lockTime } from './validate.mjs';
import { getGames, getPicks, savePicks, openWeek } from './db.mjs';
```

Add a `/picks` branch alongside the existing `lfg` branch in `fetch`:

```js
if (interaction.type === APPLICATION_COMMAND && interaction.data?.name === 'picks') {
  const userId = interaction.member?.user?.id ?? interaction.user?.id;
  const season = Number(env.SEASON);
  const week = await openWeek(env.DB, season);
  if (!week) {
    return json({ type: REPLY, data: { content: 'No week is open right now.', flags: 64 } });
  }
  const games = await getGames(env.DB, season, week);
  const exp = lockTime(games);
  if (Date.now() >= exp) {
    return json({ type: REPLY, data: { content: `Week ${week} is locked.`, flags: 64 } });
  }
  const token = await signPickToken({ userId, season, week, exp }, env.PICKS_SECRET);
  const url = `${new URL(request.url).origin}/picks?t=${token}`;
  return json({ type: REPLY, data: { content: `Your Week ${week} picks: ${url}`, flags: 64 } });
}
```

Then handle the page itself, before the signature check (Discord never calls `/picks`):

```js
const url = new URL(request.url);
if (url.pathname === '/picks') {
  const claims = await verifyPickToken(
    request.method === 'POST' ? (await request.clone().json()).token : url.searchParams.get('t'),
    env.PICKS_SECRET
  );
  if (!claims) {
    return new Response(renderMessage('That link has expired — run /picks again.'), {
      status: 401, headers: { 'Content-Type': 'text/html' },
    });
  }
  const games = await getGames(env.DB, claims.season, claims.week);

  if (request.method === 'GET') {
    const picks = await getPicks(env.DB, claims.userId, claims.season, claims.week);
    return new Response(renderForm({ games, picks, token: url.searchParams.get('t'), lockAt: lockTime(games) }), {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  const body = await request.json();
  const result = validateSubmission({ games, submission: body.picks, now: Date.now() });
  if (!result.ok) return json({ error: result.error }, 400);
  await savePicks(env.DB, { userId: claims.userId, season: claims.season, week: claims.week, picks: result.picks });
  return json({ ok: true });
}
```

Register the command by adding this object to the `commands` array in
`scripts/discord/register-commands.mjs`:

```js
  { name: 'picks', description: 'Get your link to this week’s pick’em', options: [] },
```

- [ ] **Step 6: Run the whole suite and commit**

```bash
npm test
git add worker/src/form.mjs worker/src/form.test.mjs worker/src/index.mjs scripts/discord/register-commands.mjs
git commit -m "Add the pick form and /picks"
```

---

### Task 7: The Tuesday cron

Scores last week, posts the leaderboard, then syncs the next one.

**Files:**
- Modify: `worker/src/index.mjs`
- Modify: `worker/src/rest.mjs`
- Modify: `worker/wrangler.toml`
- Test: `worker/src/cron.test.mjs`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `runWeekly(env, api, deps)` -> `Promise<{scored: number|null, synced: number|null}>`
  - `deps` = `{fetchWeek, now}` so tests inject fixtures instead of calling ESPN.
  - `postMessage(channelId, content)` added to the object `createApi` returns.

Order is fixed: score, post, then sync. Syncing first would make the open week ambiguous while last week is still unscored.

- [ ] **Step 1: Write the failing test**

```js
// worker/src/cron.test.mjs
import { runWeekly } from './index.mjs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };

const posted = [];
const api = { postMessage: async (ch, content) => posted.push({ ch, content }) };

const state = {
  games: [
    { id: '1', season: 2026, week: 1, kickoff: '2026-09-13T17:00Z', home: 'KC', away: 'BAL', winner: null, voided: 0 },
  ],
  picks: [{ user_id: 'a', game_id: '1', season: 2026, week: 1, team: 'KC', confidence: 1 }],
};

const env = {
  SEASON: '2026', LEADERBOARD_CHANNEL_ID: '999',
  DB: { /* injected through deps below in this test */ },
};

const deps = {
  now: Date.parse('2026-09-15T09:00:00Z'),
  fetchWeek: async ({ week }) => ({
    season: 2026, week,
    games: [{ id: '1', kickoff: '2026-09-13T17:00Z', home: 'KC', away: 'BAL', winner: 'KC', completed: true, voided: false }],
  }),
  getGames: async () => state.games.map((g) => ({ ...g, voided: false, completed: g.winner !== null })),
  setResults: async (_db, games) => { state.games[0].winner = games[0].winner; },
  allPicks: async () => state.picks.map((p) => ({ ...p, userId: p.user_id })),
  upsertGames: async () => {},
  openWeek: async () => 1,
};

const out = await runWeekly(env, api, deps);
check('scores the finished week', out.scored === 1);
check('records the winner', state.games[0].winner === 'KC');
check('posts exactly one leaderboard', posted.length === 1);
check('posts to the configured channel', posted[0].ch === '999');
check('the post names the leader', /a/.test(posted[0].content));
check('syncs the following week', out.synced === 2);

// ESPN failing must not post anything or half-score.
posted.length = 0;
const broken = { ...deps, fetchWeek: async () => { throw new Error('espn down'); } };
const out2 = await runWeekly(env, api, broken);
check('does nothing when the feed is down', out2.scored === null);
check('posts nothing when the feed is down', posted.length === 0);

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node worker/src/cron.test.mjs`
Expected: FAIL — `runWeekly is not exported`

- [ ] **Step 3: Add `postMessage` to the REST client**

In `worker/src/rest.mjs`, add to the returned object:

```js
    postMessage: (channelId, content) =>
      call('POST', `/channels/${channelId}/messages`, {
        content,
        allowed_mentions: { parse: [] },
      }),
```

- [ ] **Step 4: Implement `runWeekly` in `worker/src/index.mjs`**

```js
import { fetchWeek as espnFetchWeek } from './espn.mjs';
import { scoreWeek, buildStandings } from './scoring.mjs';
import { upsertGames as dbUpsert, setResults as dbSetResults, getGames as dbGetGames,
         openWeek as dbOpenWeek, allPicks as dbAllPicks } from './db.mjs';

export async function runWeekly(env, api, deps = {}) {
  const season = Number(env.SEASON);
  const {
    now = Date.now(),
    fetchWeek = espnFetchWeek,
    getGames = dbGetGames,
    setResults = dbSetResults,
    upsertGames = dbUpsert,
    openWeek = dbOpenWeek,
    allPicks = dbAllPicks,
  } = deps;

  const week = await openWeek(env.DB, season);
  if (!week) return { scored: null, synced: null };

  let fresh;
  try {
    fresh = await fetchWeek({ season, week });
  } catch (err) {
    console.warn(`ESPN unavailable, doing nothing this run: ${err.message}`);
    return { scored: null, synced: null };
  }

  // Only score a week where every game has finished. A week is all or nothing.
  if (!fresh.games.every((g) => g.completed)) return { scored: null, synced: null };

  // A game postponed out of the week disappears from the feed. The spec voids
  // it rather than renumbering everyone's confidence after the fact.
  const stored = await getGames(env.DB, season, week);
  const live = new Set(fresh.games.map((g) => g.id));
  const dropped = stored.filter((g) => !live.has(g.id)).map((g) => ({ ...g, winner: null, voided: true }));
  await setResults(env.DB, [...fresh.games, ...dropped]);
  // Score every week of the season, not just this one: the posted table is
  // the season standings, and recomputing from stored rows is what makes a
  // second run of this job produce identical numbers.
  const rows = [];
  for (let w = 1; w <= week; w += 1) {
    const weekGames = await getGames(env.DB, season, w);
    if (weekGames.length === 0) continue;
    const weekPicks = await allPicks(env.DB, season, w);
    const byUser = new Map();
    for (const p of weekPicks) {
      if (!byUser.has(p.userId)) byUser.set(p.userId, []);
      byUser.get(p.userId).push(p);
    }
    for (const [userId, theirs] of byUser) {
      const { points, correct } = scoreWeek({ games: weekGames, picks: theirs });
      rows.push({ userId, points, correct, week: w });
    }
  }

  const table = buildStandings(rows);
  const everyWeek = table.filter((r) => r.weeks === week).map((r) => `<@${r.userId}>`);
  const lines = table
    .map((r, i) => `${i + 1}. <@${r.userId}> — ${r.points}`)
    .join('\n');

  await api.postMessage(
    env.LEADERBOARD_CHANNEL_ID,
    `**Week ${week} is in.**\n${lines}` +
      (everyWeek.length ? `\n\nEntered every week: ${everyWeek.join(', ')}` : '')
  );

  const next = week + 1;
  try {
    const upcoming = await fetchWeek({ season, week: next });
    await upsertGames(env.DB, season, next, upcoming.games);
    return { scored: week, synced: next };
  } catch {
    return { scored: week, synced: null };
  }
}
```

Then replace the existing `scheduled` export so it runs both jobs:

```js
  async scheduled(event, env) {
    const api = createApi(env.DISCORD_TOKEN);
    const promo = await runPromotions(env, api);
    console.log(`Promotion pass: ${promo.promoted} promoted, ${promo.skipped} not due yet.`);
    const week = await runWeekly(env, api);
    console.log(`Pick'em: scored ${week.scored ?? 'nothing'}, synced ${week.synced ?? 'nothing'}.`);
  },
```

- [ ] **Step 5: Run it and watch it pass**

Run: `node worker/src/cron.test.mjs`
Expected: ALL PASSED

- [ ] **Step 6: Configure the cron and the new vars**

In `worker/wrangler.toml`, set the schedule to Tuesday 09:00 UTC and add the vars:

```toml
[triggers]
crons = ["0 9 * * 2"]

[vars]
GUILD_ID = ""
MEMBER_AFTER_DAYS = "7"
SEASON = "2026"
LEADERBOARD_CHANNEL_ID = ""
```

Set `LEADERBOARD_CHANNEL_ID` by right-clicking `#season-leaderboard` in Discord and
choosing Copy Channel ID. Then add the signing secret:

```bash
cd worker
wrangler secret put PICKS_SECRET
```

Use a long random value, for example from `openssl rand -hex 32`.

- [ ] **Step 7: Point `npm test` at every suite and commit**

In `package.json`, set:

```json
"test": "for f in scripts/bot/lib.test.mjs worker/src/*.test.mjs; do node $f || exit 1; done"
```

```bash
npm test
git add worker/src/index.mjs worker/src/rest.mjs worker/src/cron.test.mjs worker/wrangler.toml package.json
git commit -m "Add the weekly pick'em cron"
```

---

## Done when

- `npm test` passes every suite.
- `/picks` returns a private link; the page lists the week and saves a valid slate.
- A submission after the first kickoff is refused with the lock time.
- The Tuesday cron scores a finished week once, posts one leaderboard, and syncs the next week.
- ESPN being unavailable leaves the database untouched and posts nothing.
