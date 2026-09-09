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
