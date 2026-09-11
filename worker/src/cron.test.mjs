import { runWeekly, runCron } from './index.mjs';
import { weekOneAnnouncement } from './announce.mjs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };

const posted = [];
const api = {
  postMessage: async (ch, content, mentions) => posted.push({ ch, content, mentions }),
};

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

// Stands in for the meta table. Reset alongside `posted` — a marker left over
// from a previous block would silently suppress the next block's posts, which
// is exactly the bug these markers exist to cause on purpose in production.
const marks = new Set();

const deps = {
  now: Date.parse('2026-09-15T09:00:00Z'),
  alreadyDone: async (_db, key) => marks.has(key),
  markDone: async (_db, key) => { marks.add(key); },
  fetchWeek: async ({ week }) => ({
    season: 2026, week,
    games: [{ id: '1', kickoff: '2026-09-13T17:00Z', home: 'KC', away: 'BAL', winner: 'KC', completed: true, voided: false }],
  }),
  getGames: async () => state.games.map((g) => ({ ...g, voided: false, completed: g.winner !== null })),
  setResults: async (_db, _season, _week, games) => { state.games[0].winner = games[0].winner; },
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
marks.clear();
const broken = { ...deps, fetchWeek: async () => { throw new Error('espn down'); } };
const out2 = await runWeekly(env, api, broken);
check('does nothing when the feed is down', out2.scored === null);
check('posts nothing when the feed is down', posted.length === 0);

// Bootstrap: openWeek is null with an empty games table — day one, before
// anything has ever been seeded. runWeekly must seed the current week from
// ESPN's own scoreboard rather than sitting silent forever.
posted.length = 0;
marks.clear();
{
  let seededSeason, seededWeek, seededGames;
  const seedGames = [
    { id: '9', kickoff: '2026-10-06T17:00Z', home: 'SF', away: 'SEA', winner: null, completed: false, voided: false },
  ];
  const bootstrapDeps = {
    ...deps,
    openWeek: async () => null,
    fetchCurrentWeek: async () => ({ season: 2026, week: 4, games: seedGames }),
    upsertGames: async (_db, season, week, games) => { seededSeason = season; seededWeek = week; seededGames = games; },
  };
  const out3 = await runWeekly(env, api, bootstrapDeps);
  check('bootstrap: scores nothing', out3.scored === null);
  check('bootstrap: syncs the current week ESPN reports', out3.synced === 4);
  check('bootstrap: upserts that week\'s games', seededSeason === 2026 && seededWeek === 4 && seededGames === seedGames);
  check('bootstrap: posts no leaderboard', posted.length === 0);
}

// Bootstrap where the seed itself fails: still must not throw or post.
{
  const bootstrapBroken = {
    ...deps,
    openWeek: async () => null,
    fetchCurrentWeek: async () => { throw new Error('espn down'); },
    upsertGames: async () => { throw new Error('should not be called'); },
  };
  const out4 = await runWeekly(env, api, bootstrapBroken);
  check('bootstrap failure: scores nothing', out4.scored === null);
  check('bootstrap failure: syncs nothing', out4.synced === null);
  check('bootstrap failure: posts nothing', posted.length === 0);
}

// Finding 1: an empty ESPN slate ([].every() is vacuously true) must never
// be read as "the week is complete, void everything". It must leave stored
// games untouched, post nothing, and ask again next run.
{
  posted.length = 0;
  marks.clear();
  const before = JSON.parse(JSON.stringify(state.games));
  let setResultsCalled = false;
  const emptySlateDeps = {
    ...deps,
    fetchWeek: async ({ week }) => ({ season: 2026, week, games: [] }),
    setResults: async (...args) => { setResultsCalled = true; return deps.setResults(...args); },
  };
  const outEmpty = await runWeekly(env, api, emptySlateDeps);
  check('empty slate: scores nothing', outEmpty.scored === null);
  check('empty slate: syncs nothing', outEmpty.synced === null);
  check('empty slate: never calls setResults', setResultsCalled === false);
  check('empty slate: stored games are untouched', JSON.stringify(state.games) === JSON.stringify(before));
  check('empty slate: posts nothing', posted.length === 0);
}

// Findings 3 and 4: a season bootstrapped mid-way (games start at week 3),
// scored once week 5 finishes. "Entered every week" must count weeks that
// actually had games (3, 4, 5 — not "=== 5"), and the leaderboard post must
// carry both the season total and that week's points.
{
  posted.length = 0;
  marks.clear();
  const weeks = {
    3: { id: 'g3', home: 'KC', away: 'BAL', winner: 'KC', kickoff: '2026-09-27T17:00Z' },
    4: { id: 'g4', home: 'SF', away: 'SEA', winner: 'SF', kickoff: '2026-10-04T17:00Z' },
    5: { id: 'g5', home: 'DAL', away: 'NYG', winner: 'DAL', kickoff: '2026-10-11T17:00Z' },
  };
  const picksByWeek = {
    3: [{ user_id: 'a', game_id: 'g3', season: 2026, week: 3, team: 'KC', confidence: 1 }],
    4: [{ user_id: 'a', game_id: 'g4', season: 2026, week: 4, team: 'SF', confidence: 1 }],
    5: [{ user_id: 'a', game_id: 'g5', season: 2026, week: 5, team: 'DAL', confidence: 1 }],
  };
  const midSeasonDeps = {
    ...deps,
    openWeek: async () => 5,
    fetchWeek: async ({ week }) => {
      const g = weeks[week];
      if (!g) return { season: 2026, week, games: [] };
      return { season: 2026, week, games: [{ ...g, completed: true, voided: false }] };
    },
    getGames: async (_db, _season, w) => {
      const g = weeks[w];
      if (!g) return [];
      return [{ ...g, voided: false, completed: true }];
    },
    setResults: async () => {},
    allPicks: async (_db, _season, w) => (picksByWeek[w] ?? []).map((p) => ({ ...p, userId: p.user_id })),
  };
  const outMid = await runWeekly(env, api, midSeasonDeps);
  check('mid-season: scores the current week', outMid.scored === 5);
  check('mid-season: "entered every week" counts weeks with games, not the week number',
    /Entered every week: <@a>/.test(posted[0]?.content ?? ''));
  check('mid-season: post shows both season total and this week\'s points',
    /<@a> — 3 \(\+1 this week\)/.test(posted[0]?.content ?? ''));
}

// --- the one-off week 1 announcement -------------------------------------
// It exists to pull people into a season competition they have not entered.
// It must fire once, ping once, and never cost a scored week if it fails.

console.log('\n--- week 1 announcement ---');
{
  const text = weekOneAnnouncement({ leaderboardChannelId: '999' });
  check('pings everyone', text.startsWith('@everyone'));
  check('links the leaderboard channel', text.includes('<#999>'));
  check('names the command people must run', text.includes('/picks'));
  check('fits in a Discord message', [...text].length <= 2000);
  const noBoard = weekOneAnnouncement();
  check('degrades to plain text with no channel id',
    noBoard.includes('#season-leaderboard') && !noBoard.includes('<#undefined>'));
}

{
  posted.length = 0;
  marks.clear();
  state.games[0].winner = null;
  const out = await runWeekly({ ...env, PICKEM_CHANNEL_ID: '777' }, api, deps);
  check('still scores the week', out.scored === 1);
  check('posts the leaderboard and the announcement', posted.length === 2);
  const board = posted.find((p) => p.ch === '999');
  const shout = posted.find((p) => p.ch === '777');
  check('the announcement goes to the pickem channel', Boolean(shout));
  check('the announcement pings everyone',
    shout?.mentions?.parse?.includes('everyone') === true);
  // The leaderboard passes no allowed_mentions at all, so it inherits
  // rest.mjs's ping-nothing default — asserted directly in rest.test.mjs.
  check('the leaderboard never asks to ping anyone',
    !(board?.mentions?.parse ?? []).includes('everyone'));
  check('the announcement lands after the leaderboard', posted[0].ch === '999');
}

{
  posted.length = 0;
  marks.clear();
  state.games[0].winner = null;
  const out = await runWeekly(env, api, deps);
  check('posts only the leaderboard when no pickem channel is set',
    out.scored === 1 && posted.length === 1 && posted[0].ch === '999');
}

{
  posted.length = 0;
  marks.clear();
  state.games[0].winner = null;
  const wk2 = {
    ...deps,
    openWeek: async () => 2,
    getGames: async (_db, _season, w) =>
      w === 2 ? state.games.map((g) => ({ ...g, week: 2, voided: false, completed: g.winner !== null })) : [],
    allPicks: async (_db, _season, w) =>
      w === 2 ? state.picks.map((p) => ({ ...p, week: 2, userId: p.user_id })) : [],
  };
  const out = await runWeekly({ ...env, PICKEM_CHANNEL_ID: '777' }, api, wk2);
  check('week 2 scores without announcing', out.scored === 2);
  check('week 2 posts no announcement', !posted.some((p) => p.ch === '777'));
}

{
  posted.length = 0;
  marks.clear();
  state.games[0].winner = null;
  const flaky = {
    postMessage: async (ch, content, mentions) => {
      if (ch === '777') throw new Error('missing permissions');
      posted.push({ ch, content, mentions });
    },
  };
  // The announcement must NOT be swallowed. Writing a week's winners is what
  // advances openWeek, so a run that commits and then fails to announce can
  // never announce again — the ping is spent and nothing was sent. Failing
  // before the commit is what buys the retry.
  let threw = false;
  try {
    await runWeekly({ ...env, PICKEM_CHANNEL_ID: '777' }, flaky, deps);
  } catch (err) {
    threw = true;
  }
  check('a failed announcement fails the run', threw);
  check('a failed announcement leaves the week unscored', state.games[0].winner === null);
  check('the leaderboard it did send is recorded', marks.has('posted:2026:1'));
  check('the announcement is not recorded', !marks.has('announced:2026'));

  // Tomorrow's run, same markers: the leaderboard is skipped, the
  // announcement is retried, and the week finally commits.
  posted.length = 0;
  const out = await runWeekly({ ...env, PICKEM_CHANNEL_ID: '777' }, api, deps);
  check('the retry does not repeat the leaderboard', !posted.some((p) => p.ch === '999'));
  check('the retry sends the announcement', posted.some((p) => p.ch === '777'));
  check('the retry scores the week', out.scored === 1);
  check('the retry records the announcement', marks.has('announced:2026'));
}

// The original bug: the leaderboard post had no error handling and ran after
// the write that advances openWeek. A Discord hiccup there lost both the
// standings and the one-shot ping for good, because week 1 could never be
// scored a second time.
{
  posted.length = 0;
  marks.clear();
  state.games[0].winner = null;
  const dead = { postMessage: async () => { throw new Error('401 unauthorized'); } };

  let threw = false;
  try {
    await runWeekly({ ...env, PICKEM_CHANNEL_ID: '777' }, dead, deps);
  } catch {
    threw = true;
  }
  check('a failed leaderboard fails the run', threw);
  check('a failed leaderboard leaves the week unscored', state.games[0].winner === null);
  check('a failed leaderboard records nothing', marks.size === 0);

  // Discord comes back. Nothing was lost.
  const out = await runWeekly({ ...env, PICKEM_CHANNEL_ID: '777' }, api, deps);
  check('the retry posts the leaderboard', posted.some((p) => p.ch === '999'));
  check('the retry posts the announcement', posted.some((p) => p.ch === '777'));
  check('the retry scores the week', out.scored === 1);
  check('the ping was never lost', marks.has('announced:2026'));
}

console.log('\n--- the two jobs are independent ---');
// They used to run in sequence, unguarded. runPromotions does not catch its
// own member-list fetch, so a 401 there threw before the pick'em ran at all —
// the less important job silently cancelling the season launch.
{
  let weeklyRan = false;
  let threw = false;
  try {
    await runCron({}, {}, {
      promotions: async () => { throw new Error('401 unauthorized'); },
      weekly: async () => { weeklyRan = true; return { scored: 1, synced: 2 }; },
    });
  } catch { threw = true; }
  check('a failed promotion pass still runs the pick\'em', weeklyRan);
  check('a failed promotion pass is still reported', threw);
}

{
  let promoRan = false;
  let threw = false;
  try {
    await runCron({}, {}, {
      promotions: async () => { promoRan = true; return { promoted: 1, skipped: 0 }; },
      weekly: async () => { throw new Error('discord down'); },
    });
  } catch { threw = true; }
  check('a failed pick\'em run still promoted members', promoRan);
  check('a failed pick\'em run is still reported', threw);
}

{
  // Both broken: neither is hidden by the other, and the run still fails.
  let message = '';
  try {
    await runCron({}, {}, {
      promotions: async () => { throw new Error('no roles'); },
      weekly: async () => { throw new Error('no discord'); },
    });
  } catch (err) { message = err.message; }
  check('both failures are named', /promotions: no roles/.test(message) && /pick'em: no discord/.test(message));
}

{
  // The ordinary day: nothing thrown, so Cloudflare records a clean run.
  let ok = true;
  try {
    await runCron({}, {}, {
      promotions: async () => ({ promoted: 0, skipped: 3 }),
      weekly: async () => ({ scored: null, synced: null }),
    });
  } catch { ok = false; }
  check('a healthy run throws nothing', ok);
}

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
