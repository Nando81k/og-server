/**
 * The /bracket subcommands, end to end.
 *
 * The database here is a real (if tiny) in-memory one rather than the
 * statement recorder db.test.mjs uses, because what these need to prove is the
 * sequence: that joining then drawing then reporting leaves the tournament in
 * the state the next command reads back. A fake that returns canned rows can
 * only ever check the SQL, never the story.
 */

import { webcrypto } from 'node:crypto';
import { handleBracket, handleBracketAutocomplete, displayNameOf, MAX_TOURNAMENT_NAME } from './index.mjs';
import { openMatches, isComplete } from './bracket.mjs';
import { replay, MIN_ENTRANTS, MAX_ENTRANTS } from './tournament.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };

/** Enough of D1 to run the handler for real. */
function memoryDb() {
  const state = { tournaments: [], entrants: [], meta: new Map(), points: [] };

  const query = (sql, b) => {
    if (sql.includes('FROM tournaments') && sql.includes('status IN')) {
      return state.tournaments
        .filter((t) => t.season === b[0] && (t.status === 'signup' || t.status === 'running'))
        .sort((x, y) => (x.created_at < y.created_at ? 1 : -1))
        .slice(0, 1);
    }
    if (sql.includes('FROM tournaments WHERE id')) {
      return state.tournaments.filter((t) => t.id === b[0]);
    }
    if (sql.includes('FROM tournament_entrants')) {
      return state.entrants
        .filter((e) => e.tournament_id === b[0])
        .sort((x, y) => (x.joined_at < y.joined_at ? -1 : 1));
    }
    if (sql.includes('FROM meta')) {
      const v = state.meta.get(b[0]);
      return v ? [{ value: v }] : [];
    }
    throw new Error(`the fake database has no answer for: ${sql}`);
  };

  const apply = (sql, b) => {
    if (sql.includes('INSERT INTO tournaments')) {
      state.tournaments.push({
        id: b[0], season: b[1], name: b[2], status: 'signup', seeds: null,
        results: '[]', channel_id: b[3], created_by: b[4], created_at: b[5],
      });
      return 1;
    }
    if (sql.includes('INSERT INTO tournament_entrants')) {
      const found = state.entrants.find((e) => e.tournament_id === b[0] && e.user_id === b[1]);
      if (found) { found.display_name = b[2]; return 1; }
      state.entrants.push({ tournament_id: b[0], user_id: b[1], display_name: b[2], joined_at: b[3] });
      return 1;
    }
    if (sql.includes('DELETE FROM tournament_entrants')) {
      const i = state.entrants.findIndex((e) => e.tournament_id === b[0] && e.user_id === b[1]);
      if (i < 0) return 0;
      state.entrants.splice(i, 1);
      return 1;
    }
    if (sql.includes("SET status = 'running'")) {
      const t = state.tournaments.find((x) => x.id === b[1] && x.status === 'signup');
      if (!t) return 0;
      t.status = 'running';
      t.seeds = b[0];
      return 1;
    }
    if (sql.includes('SET results =')) {
      const t = state.tournaments.find((x) => x.id === b[1] && x.results === b[2]);
      if (!t) return 0;
      t.results = b[0];
      return 1;
    }
    if (sql.includes('UPDATE tournaments SET status = ?')) {
      const t = state.tournaments.find((x) => x.id === b[1]);
      if (!t) return 0;
      t.status = b[0];
      return 1;
    }
    if (sql.includes('INSERT INTO meta')) {
      if (state.meta.has(b[0])) return 0;
      state.meta.set(b[0], b[1]);
      return 1;
    }
    if (sql.includes('INSERT INTO points')) {
      state.points.push({ season: b[0], userId: b[1], amount: b[2], reason: b[3], awardedBy: b[4] });
      return 1;
    }
    throw new Error(`the fake database cannot run: ${sql}`);
  };

  return {
    state,
    prepare(sql) {
      let binds = [];
      const stmt = {
        bind(...a) { binds = a; return stmt; },
        async run() { return { success: true, meta: { changes: apply(sql, binds) } }; },
        async all() { return { results: query(sql, binds) }; },
      };
      return stmt;
    },
  };
}

const MANAGE_MESSAGES = String(1 << 13);
const member = (id, { mod = false, nick = null } = {}) => ({
  user: { id, username: `user${id}`, global_name: `User ${id}` },
  nick,
  permissions: mod ? MANAGE_MESSAGES : '0',
});

const run = (env, who, name, args = {}) => handleBracket({
  data: { name: 'bracket', options: [{ name, options: Object.entries(args).map(([k, v]) => ({ name: k, value: v })) }] },
  member: who,
  channel_id: '999',
}, env);

const newEnv = () => ({ SEASON: '2026', DB: memoryDb() });
const MOD = member('mod', { mod: true });

console.log('--- who may do what ---');
{
  const env = newEnv();
  for (const sub of ['create', 'start', 'undo', 'cancel']) {
    const res = await run(env, member('rando'), sub, sub === 'create' ? { name: 'x' } : {});
    check(`a member cannot ${sub} a tournament`, res.content.includes('Only mods'));
    check(`the refusal for ${sub} is private`, res.flags === 64);
  }
  check('the refusal points at what they can do',
    (await run(env, member('rando'), 'cancel')).content.includes('/bracket join'));
  check('nothing was created by the refused commands', env.DB.state.tournaments.length === 0);
}

console.log('\n--- with nothing running ---');
{
  const env = newEnv();
  for (const sub of ['join', 'leave', 'view', 'report']) {
    const res = await run(env, member('a'), sub);
    check(`${sub} says there is no tournament`, res.content.includes('No tournament is running'));
  }
  check('it says how to open one',
    (await run(env, member('a'), 'view')).content.includes('/bracket create'));
}

console.log('\n--- creating ---');
{
  const env = newEnv();
  const res = await run(env, MOD, 'create', { name: 'Winter Brawl' });
  check('a mod can create one', res.content.includes('Winter Brawl'));
  check('the post is public, so people can see it and join', res.flags === undefined);
  check('it never pings anyone', res.allowed_mentions?.parse?.length === 0);
  check('it is stored open for sign-ups', env.DB.state.tournaments[0].status === 'signup');
  check('it is stored against the season', env.DB.state.tournaments[0].season === 2026);
  check('it remembers where it was created', env.DB.state.tournaments[0].channel_id === '999');

  const second = await run(env, MOD, 'create', { name: 'Something Else' });
  check('a second one is refused while the first is open',
    second.content.includes('Winter Brawl') && second.content.includes('/bracket cancel'));
  check('and no second row was written', env.DB.state.tournaments.length === 1);

  check('an empty name is refused',
    (await newEnvCreate('   ')).content === 'Give it a name.');
  const long = await newEnvCreate('N'.repeat(200));
  check('an over-long name is trimmed rather than rejected',
    long.content.includes('N'.repeat(MAX_TOURNAMENT_NAME)) &&
    !long.content.includes('N'.repeat(MAX_TOURNAMENT_NAME + 1)));
}
async function newEnvCreate(name) {
  return run(newEnv(), MOD, 'create', { name });
}

console.log('\n--- signing up ---');
{
  const env = newEnv();
  await run(env, MOD, 'create', { name: 'Winter Brawl' });

  const first = await run(env, member('a'), 'join');
  check('joining lists you', first.content.includes('<@a>'));
  check('the list is public', first.flags === undefined);

  await run(env, member('a'), 'join');
  check('joining twice does not seat you twice', env.DB.state.entrants.length === 1);

  await run(env, member('b', { nick: 'Nickname' }), 'join');
  check('a server nickname is what gets stored',
    env.DB.state.entrants.find((e) => e.user_id === 'b').display_name === 'Nickname');

  const left = await run(env, member('a'), 'leave');
  check('leaving takes you off the list', !left.content.includes('<@a>'));
  check('leaving when you never joined says so',
    (await run(env, member('zz'), 'leave')).content === 'You were not in it.');

  const short = await run(env, MOD, 'start');
  check('a bracket cannot start under the minimum',
    short.content.includes(`at least ${MIN_ENTRANTS}`));
  check('and nothing was drawn', env.DB.state.tournaments[0].seeds === null);
}

console.log('\n--- drawing the bracket ---');
{
  const env = newEnv();
  await run(env, MOD, 'create', { name: 'Winter Brawl' });
  for (const id of ['a', 'b', 'c', 'd', 'e']) await run(env, member(id), 'join');

  const started = await run(env, MOD, 'start');
  check('starting says what to play', started.content.includes('Play these now'));
  check('it counts the entrants', started.content.includes('5 entrants'));
  check('the tournament is now running', env.DB.state.tournaments[0].status === 'running');

  const seeds = JSON.parse(env.DB.state.tournaments[0].seeds);
  check('the draw holds everyone exactly once',
    seeds.length === 5 && new Set(seeds).size === 5);
  check('the draw is only the people who signed up',
    seeds.every((s) => ['a', 'b', 'c', 'd', 'e'].includes(s)));

  check('joining after the draw is refused',
    (await run(env, member('f'), 'join')).content.includes('already been drawn'));
  check('and nobody was added', env.DB.state.entrants.length === 5);
  check('leaving after the draw is refused too',
    (await run(env, member('a'), 'leave')).content.includes('already been drawn'));
  check('starting twice is refused',
    (await run(env, MOD, 'start')).content.includes('already running'));
  check('the draw was not reshuffled by the second start',
    env.DB.state.tournaments[0].seeds === JSON.stringify(seeds));
}

console.log('\n--- reporting ---');
{
  const env = newEnv();
  await run(env, MOD, 'create', { name: 'Winter Brawl' });
  for (const id of ['a', 'b', 'c', 'd']) await run(env, member(id), 'join');
  await run(env, MOD, 'start');

  const seeds = JSON.parse(env.DB.state.tournaments[0].seeds);
  const live = () => replay(seeds, JSON.parse(env.DB.state.tournaments[0].results));
  const first = openMatches(live())[0];

  check('a bystander cannot report someone else’s set',
    (await run(env, member('nobody'), 'report', { match: first.id, winner: first.a }))
      .content.includes('Only the two players'));
  check('and nothing was recorded', env.DB.state.tournaments[0].results === '[]');

  check('a match that is not open is refused',
    (await run(env, MOD, 'report', { match: 'W9-9', winner: first.a }))
      .content.includes('not a match waiting'));
  check('someone not in the match cannot be named the winner',
    (await run(env, member(first.a), 'report', { match: first.id, winner: 'nobody' }))
      .content.includes('not in'));

  const ok = await run(env, member(first.a), 'report', { match: first.id, winner: first.a });
  check('a player can report their own set', ok.content.includes('matches played'));
  check('the result is stored',
    JSON.parse(env.DB.state.tournaments[0].results)[0].winner === first.a);
  check('the same set cannot be reported twice',
    (await run(env, member(first.a), 'report', { match: first.id, winner: first.b }))
      .content.includes('not a match waiting'));

  const second = openMatches(live())[0];
  check('a mod can report a set they are not in',
    (await run(env, MOD, 'report', { match: second.id, winner: second.a }))
      .content.includes('matches played'));
}

console.log('\n--- two people reporting at once ---');
{
  // The case the compare-and-swap exists for: both commands read the same
  // results list, and a plain overwrite would drop whichever landed first.
  const env = newEnv();
  await run(env, MOD, 'create', { name: 'Winter Brawl' });
  for (const id of ['a', 'b', 'c', 'd']) await run(env, member(id), 'join');
  await run(env, MOD, 'start');
  const seeds = JSON.parse(env.DB.state.tournaments[0].seeds);
  const open = openMatches(replay(seeds, []));

  const [one, two] = await Promise.all([
    run(env, MOD, 'report', { match: open[0].id, winner: open[0].a }),
    run(env, MOD, 'report', { match: open[1].id, winner: open[1].a }),
  ]);
  const stored = JSON.parse(env.DB.state.tournaments[0].results);
  check('exactly one of the two lands', stored.length === 1);
  const loser = [one, two].find((r) => r.content.includes('same moment'));
  check('the other is told to run it again, not silently dropped', Boolean(loser));
  check('the refusal is private, so the channel is not spammed', loser.flags === 64);

  // The advice the refusal gives has to actually work, or it is just a dead
  // end wearing a retry message.
  const missed = open.find((m) => !stored.some((r) => r.match === m.id));
  const retried = await run(env, MOD, 'report', { match: missed.id, winner: missed.a });
  check('running it again lands it', retried.content.includes('matches played'));
  check('both results are now stored',
    JSON.parse(env.DB.state.tournaments[0].results).length === 2);
  check('neither result was lost',
    open.every((m) => JSON.parse(env.DB.state.tournaments[0].results).some((r) => r.match === m.id)));
}

console.log('\n--- undo ---');
{
  const env = newEnv();
  await run(env, MOD, 'create', { name: 'Winter Brawl' });
  for (const id of ['a', 'b', 'c', 'd']) await run(env, member(id), 'join');
  await run(env, MOD, 'start');
  const seeds = JSON.parse(env.DB.state.tournaments[0].seeds);

  check('there is nothing to undo yet',
    (await run(env, MOD, 'undo')).content.includes('Nothing has been reported'));

  const first = openMatches(replay(seeds, []))[0];
  await run(env, member(first.a), 'report', { match: first.id, winner: first.a });
  const undone = await run(env, MOD, 'undo');
  check('undo names what it took back', undone.content.includes(first.id));
  check('the result is gone from storage', env.DB.state.tournaments[0].results === '[]');
  check('the match is playable again',
    openMatches(replay(seeds, [])).some((m) => m.id === first.id));
  check('it can then be reported the other way',
    (await run(env, member(first.b), 'report', { match: first.id, winner: first.b }))
      .content.includes('matches played'));
  check('and the new result is what is stored',
    JSON.parse(env.DB.state.tournaments[0].results)[0].winner === first.b);
}

console.log('\n--- playing one all the way out ---');
{
  const env = newEnv();
  await run(env, MOD, 'create', { name: 'Winter Brawl' });
  const players = ['a', 'b', 'c', 'd', 'e', 'f'];
  for (const id of players) await run(env, member(id), 'join');
  await run(env, MOD, 'start');
  const seeds = JSON.parse(env.DB.state.tournaments[0].seeds);
  const live = () => replay(seeds, JSON.parse(env.DB.state.tournaments[0].results));

  let last = null;
  for (let guard = 0; guard < 100 && !isComplete(live()); guard += 1) {
    const m = openMatches(live())[0];
    if (!m) break;
    last = await run(env, MOD, 'report', { match: m.id, winner: m.a });
  }

  check('the bracket finishes', isComplete(live()));
  check('the last reply is the final standings', last.content.includes('final'));
  check('it says where the points went', last.content.includes('season leaderboard'));
  check('it says how to fix a wrong result', last.content.includes('/award'));
  check('the tournament is closed', env.DB.state.tournaments[0].status === 'done');

  const paid = env.DB.state.points;
  check('everyone who entered was paid', paid.length === players.length);
  check('nobody was paid twice', new Set(paid.map((p) => p.userId)).size === players.length);
  check('exactly one person got the winner’s points',
    paid.filter((p) => p.amount === 50).length === 1);
  check('the ledger says which tournament it was for',
    paid.every((p) => p.reason.startsWith('Winter Brawl — ')));
  check('the awards are stamped with the season', paid.every((p) => p.season === 2026));
  check('the payout is marked done so it cannot run twice',
    [...env.DB.state.meta.keys()].some((k) => k.endsWith(':awarded')));

  // With the tournament closed, the commands should find nothing open rather
  // than keep operating on a finished bracket.
  check('a finished tournament is no longer the active one',
    (await run(env, member('a'), 'view')).content.includes('No tournament is running'));
  check('a new one can now be created',
    (await run(env, MOD, 'create', { name: 'Spring Brawl' })).content.includes('Spring Brawl'));
}

console.log('\n--- cancelling ---');
{
  const env = newEnv();
  await run(env, MOD, 'create', { name: 'Winter Brawl' });
  for (const id of ['a', 'b', 'c']) await run(env, member(id), 'join');
  await run(env, MOD, 'start');
  const res = await run(env, MOD, 'cancel');
  check('cancelling says so', res.content.includes('is off'));
  check('it is explicit that nobody got points', res.content.includes('No points'));
  check('nothing was written to the ledger', env.DB.state.points.length === 0);
  check('the tournament is closed', env.DB.state.tournaments[0].status === 'cancelled');
  check('a new one can be created after a cancel',
    (await run(env, MOD, 'create', { name: 'Next One' })).content.includes('Next One'));
}

console.log('\n--- viewing ---');
{
  const env = newEnv();
  check('view before anything says there is nothing',
    (await run(env, member('a'), 'view')).content.includes('No tournament'));
  await run(env, MOD, 'create', { name: 'Winter Brawl' });
  check('view during sign-ups shows the list',
    (await run(env, member('a'), 'view')).content.includes('sign-ups open'));
  for (const id of ['a', 'b', 'c']) await run(env, member(id), 'join');
  await run(env, MOD, 'start');
  check('view once running shows the matches',
    (await run(env, member('a'), 'view')).content.includes('Play these now'));
}

console.log('\n--- autocomplete ---');
{
  const env = newEnv();
  const ac = (typed) => handleBracketAutocomplete({
    data: { name: 'bracket', options: [{ name: 'report', options: [{ name: 'match', value: typed, focused: true }] }] },
  }, env);

  check('nothing running offers nothing', (await ac('')).length === 0);

  await run(env, MOD, 'create', { name: 'Winter Brawl' });
  check('sign-ups offer nothing, because no match exists yet', (await ac('')).length === 0);

  for (const id of ['a', 'b', 'c', 'd']) await run(env, member(id, { nick: `Nick${id}` }), 'join');
  await run(env, MOD, 'start');

  const all = await ac('');
  check('a running bracket offers its open matches', all.length === 2);
  check('choices read as names, not raw ids',
    all.every((c) => /Nick[a-d] vs Nick[a-d]/.test(c.name)));
  check('the value is the match id the handler needs',
    all.every((c) => /^W1-\d$/.test(c.value)));
  check('typing a name narrows it', (await ac('Nicka')).length === 1);
  check('typing nonsense offers nothing', (await ac('qqqq')).length === 0);
}

console.log('\n--- what to call people ---');
check('a nickname wins', displayNameOf({ nick: 'Nando', user: { global_name: 'X', username: 'y' } }) === 'Nando');
check('then the display name', displayNameOf({ user: { global_name: 'Nando', username: 'y' } }) === 'Nando');
check('then the username', displayNameOf({ user: { username: 'nando81k' } }) === 'nando81k');
check('and never undefined', displayNameOf(undefined) === 'someone');
check('an empty nickname falls through rather than rendering blank',
  displayNameOf({ nick: '', user: { username: 'nando81k' } }) === 'nando81k');

console.log('\n--- the cap on entrants ---');
{
  const env = newEnv();
  await run(env, MOD, 'create', { name: 'Big One' });
  for (let i = 0; i < MAX_ENTRANTS; i += 1) await run(env, member(`p${i}`), 'join');
  const full = await run(env, member('onemore'), 'join');
  check(`sign-ups close at ${MAX_ENTRANTS}`, full.content.includes(`full at ${MAX_ENTRANTS}`));
  check('and the extra person was not seated', env.DB.state.entrants.length === MAX_ENTRANTS);
  check('someone already in can still re-run join without being refused',
    !(await run(env, member('p0'), 'join')).content.includes('full'));
}

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
