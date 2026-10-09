/**
 * Fantasy trade proposals, end to end.
 *
 * The pure rules (tallying, the outcome decision, validation, matching a
 * processed trade) are checked directly. The handlers run for real against a
 * small in-memory database and a stub Discord API, because what matters is the
 * sequence: link, propose, vote, close, and that each step leaves the state the
 * next one reads. Nothing here talks to ESPN or Discord.
 */

import {
  tallyVotes, decide, parseCustomId, customId, voteComponents, proposalMessage, closedMessage,
  resultAnnouncement, validateProposal, findCompletedTrades, clean, QUORUM,
} from './trade.mjs';
import {
  handleFantasy, handleTrade, handleTradeVote, runTradeClose, runTradeSync, handleFantasyAutocomplete,
} from './index.mjs';
import { COMMANDS, TRADE_MOD_ONLY } from '../../shared/commands.mjs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };
const throws = async (fn) => { try { await fn(); return false; } catch { return true; } };

// ------------------------------------------------------------------ pure rules
console.log('--- tallying ---');
const v = (userId, vote) => ({ userId, vote });
let t = tallyVotes([v('a', 'fair'), v('b', 'fair'), v('c', 'robbery')]);
check('counts each option', t.fair === 2 && t.robbery === 1 && t.collusion === 0 && t.total === 3);
check('ignores excluded voters', tallyVotes([v('a', 'fair'), v('b', 'fair')], ['a']).total === 1);
check('ignores a vote that is not an option', tallyVotes([v('a', 'maybe')]).total === 0);
check('no votes is a clean zero', tallyVotes([]).total === 0);

console.log('\n--- the outcome rules ---');
const tl = (fair, collusion, robbery) => ({ fair, collusion, robbery, total: fair + collusion + robbery });
check(`under ${QUORUM} votes goes to the mods`, decide(tl(2, 0, 0)).status === 'no_quorum');
check('no votes at all goes to the mods', decide(tl(0, 0, 0)).status === 'no_quorum');
check('the reason says how many votes there were', decide(tl(1, 0, 0)).reason.includes('1 vote;'));
check('three fair votes approve', decide(tl(3, 0, 0)).status === 'approved');
check('a clear majority approves', decide(tl(7, 1, 1)).status === 'approved');
check('exactly a third Collusion flags it (3 of 9)', decide(tl(6, 3, 0)).status === 'flagged');
check('exactly a third Robbery flags it (3 of 9)', decide(tl(6, 0, 3)).status === 'flagged');
check('just under a third does not (2 of 7)', decide(tl(5, 2, 0)).status === 'approved');
check('with three votes, one Robbery is already a third', decide(tl(2, 0, 1)).status === 'flagged');
check('Fair not the top choice flags it', decide(tl(2, 2, 2)).status === 'flagged');
check('a tie between Fair and a concern flags it', decide(tl(4, 4, 0)).status === 'flagged');
check('every decision explains itself', [tl(0, 0, 0), tl(3, 0, 0), tl(6, 3, 0), tl(2, 2, 2)].every((x) => decide(x).reason.length > 5));

console.log('\n--- button ids ---');
check('round-trips', JSON.stringify(parseCustomId(customId(12, 'fair'))) === '{"tradeId":12,"vote":"fair"}');
check('rejects other ids', parseCustomId('lfg:12:fair') === null && parseCustomId('trade:x:fair') === null);
check('rejects an unknown vote', parseCustomId('trade:12:meh') === null);
check('rejects nothing', parseCustomId(undefined) === null);
const comps = voteComponents(12);
check('one row of three buttons', comps.length === 1 && comps[0].components.length === 3);
check('every button carries its own id', comps[0].components.map((c) => c.custom_id).join() === 'trade:12:fair,trade:12:collusion,trade:12:robbery');
check('custom ids fit Discord\'s 100 characters', comps[0].components.every((c) => c.custom_id.length <= 100));
check('labels fit Discord\'s 80', comps[0].components.every((c) => c.label.length <= 80));

console.log('\n--- messages ---');
const trade = {
  id: 12, proposerId: 'u1', fromName: 'Fernando\'s Fantastic Team', toName: 'Ya Soul',
  give: [{ id: 100, name: 'Marcus Vale' }, { id: 101, name: 'Jules Okafor' }],
  get: [{ id: 200, name: 'Theo Brandt' }], note: 'Need guards.\nBad for you? say so.',
  closesAt: '2027-01-02T03:04:05.000Z',
};
const card = proposalMessage({ trade, tally: tl(5, 0, 2), otherUserId: 'u2' });
check('card names the trade and both teams', card.includes('**Trade #12**') && card.includes('Ya Soul'));
check('card lists both sides', card.includes('Marcus Vale, Jules Okafor') && card.includes('Theo Brandt'));
check('card shows the tally', card.includes('Fair') && /Fair\s+█+\s+5/.test(card) && /Robbery\s+█+\s+2/.test(card));
check('card counts votes', card.includes('7 votes'));
check('card shows a live countdown', card.includes(`<t:${Date.parse(trade.closesAt) / 1000}:R>`));
check('card tells the other manager', card.includes('<@u2>'));
check('card keeps the note on one line', card.includes('> Need guards. Bad for you? say so.'));
check('card fits Discord\'s 2000', card.length < 2000);
check('one vote reads in the singular', proposalMessage({ trade, tally: tl(1, 0, 0) }).includes('1 vote ·'));
check('without the other manager it still reads', !proposalMessage({ trade, tally: tl(0, 0, 0) }).includes('<@undefined>'));
const done = closedMessage({ trade, tally: tl(5, 0, 2), status: 'approved', reason: 'Fair was the top choice.' });
check('a closed card leads with the outcome', done.startsWith('✅'));
check('a closed card freezes the tally', /Fair\s+█+\s+5/.test(done));
check('flagged tells mods what to run', closedMessage({ trade, tally: tl(1, 3, 0), status: 'flagged', reason: 'x' }).includes('/trade veto'));
check('vetoed says so', closedMessage({ trade, tally: tl(0, 0, 0), status: 'vetoed' }).includes('Vetoed'));
check('completed says so', closedMessage({ trade, tally: tl(0, 0, 0), status: 'completed' }).includes('Completed in ESPN'));
check('announcement carries the final count', resultAnnouncement({ trade, tally: tl(5, 0, 2), decision: decide(tl(5, 0, 2)) }).includes('Fair 5 · Collusion 0 · Robbery 2 (7 votes)'));
check('clean flattens whitespace and trims', clean('  a \n b  ') === 'a b');
check('clean cuts to length', clean('x'.repeat(500), 50).length === 50);

console.log('\n--- validating a proposal ---');
const rosters = {
  teams: [
    { id: 1, name: 'Fernando\'s Fantastic Team', players: [{ id: 100, name: 'Marcus Vale' }, { id: 101, name: 'Jules Okafor' }] },
    { id: 2, name: 'Ya Soul', players: [{ id: 200, name: 'Theo Brandt' }, { id: 201, name: 'Dario Reyes' }] },
    { id: 3, name: 'Team 3', players: [{ id: 300, name: 'Andre Kessler' }] },
  ],
  tradeDeadline: null,
};
const base = { mine: { teamId: 1 }, toTeamId: 2, giveIds: [100], getIds: [200], rosters };
let r = validateProposal(base);
check('a good proposal passes with names resolved', r.ok && r.give[0].name === 'Marcus Vale' && r.get[0].name === 'Theo Brandt');
check('and carries both teams', r.from.id === 1 && r.to.name === 'Ya Soul');
check('two for two passes', validateProposal({ ...base, giveIds: [100, 101], getIds: [200, 201] }).ok);
check('cannot trade with yourself', validateProposal({ ...base, toTeamId: 1 }).error.includes('yourself'));
check('unknown team', validateProposal({ ...base, toTeamId: 99 }).error.includes('not in the league'));
check('your linked team has left the league', validateProposal({ ...base, mine: { teamId: 99 } }).error.includes('/fantasy link'));
check('needs a player each side', validateProposal({ ...base, giveIds: [] }).error.includes('at least one'));
check('needs a player each side (other)', validateProposal({ ...base, getIds: [] }).error.includes('at least one'));
check('rejects the same player twice', validateProposal({ ...base, giveIds: [100, 100] }).error.includes('twice'));
check('cannot give a player you do not have', validateProposal({ ...base, giveIds: [200] }).error.includes('your roster'));
check('cannot get a player they do not have', validateProposal({ ...base, getIds: [100] }).error.includes('roster'));
const liveTrade = { id: 7, give: [{ id: 100, name: 'Marcus Vale' }], get: [{ id: 300, name: 'Andre Kessler' }] };
check('a player in another open trade is locked', validateProposal({ ...base, live: [liveTrade] }).error.includes('already in open trade #7'));
check('a player in the other side of a live trade is locked too', validateProposal({ ...base, giveIds: [101], getIds: [300], toTeamId: 3, live: [liveTrade] }).error?.includes('#7') === true);
check('unrelated live trades do not matter', validateProposal({ ...base, live: [{ id: 8, give: [{ id: 101, name: 'x' }], get: [] }] }).ok);
check('after the deadline is refused', validateProposal({ ...base, deadline: 1000, now: 2000 }).error.includes('deadline'));
check('before the deadline is fine', validateProposal({ ...base, deadline: 3000, now: 2000 }).ok);

console.log('\n--- matching a trade ESPN processed ---');
const act = (date, playerId, kind = 'traded') => ({ date, playerId, kind });
const lt = { id: 1, give: [{ id: 100 }, { id: 101 }], get: [{ id: 200 }] };
check('the same players on one timestamp match',
  findCompletedTrades([act(5, 100), act(5, 101), act(5, 200)], [lt]).length === 1);
check('order does not matter', findCompletedTrades([act(5, 200), act(5, 101), act(5, 100)], [lt]).length === 1);
check('a subset is a different deal', findCompletedTrades([act(5, 100), act(5, 200)], [lt]).length === 0);
check('a superset is a different deal', findCompletedTrades([act(5, 100), act(5, 101), act(5, 200), act(5, 300)], [lt]).length === 0);
check('players spread over two timestamps do not combine', findCompletedTrades([act(5, 100), act(5, 101), act(6, 200)], [lt]).length === 0);
check('adds and drops are not trades', findCompletedTrades([act(5, 100, 'dropped'), act(5, 101, 'dropped'), act(5, 200, 'dropped')], [lt]).length === 0);
check('nothing processed, nothing matched', findCompletedTrades([], [lt]).length === 0);

// ------------------------------------------------------------- the handlers
function memoryDb() {
  const state = { links: [], trades: [], votes: [], meta: new Map(), nextId: 1 };

  const query = (sql, b) => {
    if (sql.includes('FROM fantasy_links WHERE season = ? AND user_id')) {
      return state.links.filter((l) => l.season === b[0] && l.user_id === b[1]);
    }
    if (sql.includes('FROM fantasy_links WHERE season = ? AND team_id')) {
      return state.links.filter((l) => l.season === b[0] && l.team_id === b[1]);
    }
    if (sql.includes('FROM trades WHERE id = ?')) return state.trades.filter((x) => x.id === b[0]);
    if (sql.includes("status IN ('open'")) {
      return state.trades.filter((x) => x.season === b[0] && ['open', 'approved', 'flagged', 'no_quorum'].includes(x.status));
    }
    if (sql.includes("status = 'open' AND closes_at <= ?")) {
      return state.trades.filter((x) => x.status === 'open' && x.closes_at <= b[0]);
    }
    if (sql.includes('FROM trade_votes')) return state.votes.filter((x) => x.trade_id === b[0]);
    if (sql.includes('FROM meta')) {
      const val = state.meta.get(b[0]);
      return val ? [{ value: val }] : [];
    }
    throw new Error(`the fake database has no answer for: ${sql}`);
  };

  const apply = (sql, b) => {
    if (sql.includes('DELETE FROM fantasy_links')) {
      const before = state.links.length;
      state.links = state.links.filter((l) => !(l.season === b[0] && l.team_id === b[1]));
      return { changes: before - state.links.length };
    }
    if (sql.includes('INSERT INTO fantasy_links')) {
      const found = state.links.find((l) => l.user_id === b[0] && l.season === b[1]);
      if (found) { found.team_id = b[2]; found.team_name = b[3]; return { changes: 1 }; }
      if (state.links.some((l) => l.season === b[1] && l.team_id === b[2])) throw new Error('UNIQUE constraint failed: fantasy_links.team_id');
      state.links.push({ user_id: b[0], season: b[1], team_id: b[2], team_name: b[3], linked_at: b[4] });
      return { changes: 1 };
    }
    if (sql.includes('INSERT INTO trades')) {
      const id = state.nextId++;
      state.trades.push({
        id, season: b[0], proposer_id: b[1], from_team: b[2], to_team: b[3], from_name: b[4], to_name: b[5],
        give: b[6], get: b[7], note: b[8], status: 'open', channel_id: null, message_id: null,
        created_at: b[9], closes_at: b[10], resolved_at: null,
      });
      return { changes: 1, last_row_id: id };
    }
    if (sql.includes('UPDATE trades SET channel_id')) {
      const x = state.trades.find((y) => y.id === b[2]);
      if (!x) return { changes: 0 };
      x.channel_id = b[0]; x.message_id = b[1];
      return { changes: 1 };
    }
    if (sql.includes('UPDATE trades SET status')) {
      const x = state.trades.find((y) => y.id === b[2] && b.slice(3).includes(y.status));
      if (!x) return { changes: 0 };
      x.status = b[0]; x.resolved_at = b[1];
      return { changes: 1 };
    }
    if (sql.includes('INSERT INTO trade_votes')) {
      const found = state.votes.find((x) => x.trade_id === b[0] && x.user_id === b[1]);
      if (found) { found.vote = b[2]; return { changes: 1 }; }
      state.votes.push({ trade_id: b[0], user_id: b[1], vote: b[2], voted_at: b[3] });
      return { changes: 1 };
    }
    if (sql.includes('INSERT INTO meta')) {
      if (state.meta.has(b[0])) return { changes: 0 };
      state.meta.set(b[0], b[1]);
      return { changes: 1 };
    }
    throw new Error(`the fake database cannot run: ${sql}`);
  };

  return {
    state,
    prepare(sql) {
      let binds = [];
      const stmt = {
        bind(...a) { binds = a; return stmt; },
        async run() { return { success: true, meta: apply(sql, binds) }; },
        async all() { return { results: query(sql, binds) }; },
      };
      return stmt;
    },
  };
}

function stubApi() {
  const api = { posted: [], edited: [], n: 0, failEdit: false, failPost: false };
  api.postMessage = async (channel, content, mentions, extra) => {
    if (api.failPost) throw new Error('discord down');
    api.posted.push({ channel, content, mentions, extra });
    return { id: `m${++api.n}` };
  };
  api.editMessage = async (channel, id, body) => {
    if (api.failEdit) throw new Error('discord down');
    api.edited.push({ channel, id, body });
    return {};
  };
  return api;
}

const MANAGE_MESSAGES = String(1 << 13);
const who = (id, mod = false) => ({ user: { id, username: id }, permissions: mod ? MANAGE_MESSAGES : '0' });
const MOD = who('mod', true);
const sub = (name, args) => ({ name, options: Object.entries(args ?? {}).map(([k, val]) => ({ name: k, value: val })) });
const cmd = (name, subName, args, member) => ({ data: { name, options: [sub(subName, args)] }, member, channel_id: '555' });

const NOW = Date.parse('2027-01-01T12:00:00Z');
const env0 = () => ({ FANTASY_LEAGUE_ID: '123', FANTASY_SEASON: '2027', TRADE_CHANNEL_ID: '777', DB: memoryDb() });
const stubRosters = async () => rosters;
const link = (env, userId, teamId, extra = {}) =>
  handleFantasy(cmd('fantasy', 'link', { team: String(teamId), ...extra }, who(userId)), env, { fetchRosters: stubRosters });
const propose = (env, api, userId, args, deps = {}) =>
  handleTrade(cmd('trade', 'propose', args, who(userId)), env, api, { fetchRosters: stubRosters, now: NOW, ...deps });
const GOOD = { team: '2', give: '100', get: '200', note: 'Need guards.' };

async function setup() {
  const env = env0();
  const api = stubApi();
  await link(env, 'u1', 1);
  await link(env, 'u2', 2);
  return { env, api };
}

console.log('\n--- /fantasy link ---');
{
  const env = env0();
  let out = await link(env, 'u1', 1);
  check('links a team and says so', out.content.includes('<@u1> is now **Fernando\'s Fantastic Team**'));
  check('the reply pings nobody', out.allowed_mentions.parse.length === 0);
  check('it is stored', env.DB.state.links.length === 1 && env.DB.state.links[0].team_id === 1);
  out = await link(env, 'u1', 3);
  check('linking again moves you to the new team', env.DB.state.links.length === 1 && env.DB.state.links[0].team_id === 3);
  out = await link(env, 'u2', 3);
  check('a team someone holds is refused', out.flags === 64 && out.content.includes('<@u1>'));
  check('and not stolen', env.DB.state.links.find((l) => l.team_id === 3).user_id === 'u1');
  out = await link(env, 'u2', 99);
  check('a team not in the league is refused', out.flags === 64 && out.content.includes('not in the league'));
  out = await link(env, 'u2', 1, { user: 'u9' });
  check('a member cannot link someone else', out.flags === 64 && out.content.includes('Only mods'));
  out = await handleFantasy(cmd('fantasy', 'link', { team: '3', user: 'u9' }, MOD), env, { fetchRosters: stubRosters });
  check('a mod can reassign a held team', out.content.includes('<@u9> is now') && env.DB.state.links.find((l) => l.team_id === 3).user_id === 'u9');
  check('and the old claim is gone', !env.DB.state.links.some((l) => l.user_id === 'u1'));
  out = await handleFantasy(cmd('fantasy', 'link', { team: '1' }, who('u1')), {}, { fetchRosters: stubRosters });
  check('before setup, says so privately', out.flags === 64);
}

console.log('\n--- /trade propose ---');
{
  const { env, api } = await setup();
  let out = await propose(env, api, 'u1', GOOD);
  check('a good proposal is accepted', out.flags === 64 && out.content.includes('#1') && out.content.includes('<#777>'));
  check('the card is posted once, to the trade channel', api.posted.length === 1 && api.posted[0].channel === '777');
  check('the card carries the vote buttons', api.posted[0].extra.components[0].components.length === 3);
  check('the card pings only the other manager', api.posted[0].mentions.parse.length === 0 && api.posted[0].mentions.users.join() === 'u2');
  check('the card shows the deal', api.posted[0].content.includes('Marcus Vale') && api.posted[0].content.includes('Theo Brandt'));
  const row = env.DB.state.trades[0];
  check('the trade is stored open', row.status === 'open' && row.proposer_id === 'u1' && row.from_team === 1 && row.to_team === 2);
  check('with the card\'s message id', row.channel_id === '777' && row.message_id === 'm1');
  check('closing 24 hours out by default', Date.parse(row.closes_at) - NOW === 24 * 3600 * 1000);
  check('players are stored with names', JSON.parse(row.give)[0].name === 'Marcus Vale');

  out = await propose(env, api, 'u1', { ...GOOD, give: '101', get: '200' });
  check('a player already in an open trade is refused', out.flags === 64 && out.content.includes('already in open trade #1'));
  check('and nothing was posted or stored for it', api.posted.length === 1 && env.DB.state.trades.length === 1);

  out = await propose(env, api, 'u9', GOOD);
  check('an unlinked user is told to link', out.flags === 64 && out.content.includes('/fantasy link'));
  out = await propose(env, api, 'u1', { ...GOOD, team: '1' });
  check('trading with yourself is refused', out.content.includes('yourself'));
  out = await propose(env, api, 'u1', { ...GOOD, team: 'abc' });
  check('a hand-typed team is refused', out.content.includes('from the lists'));
  out = await propose(env, api, 'u1', { team: '2', give: '101', get: '201', give2: '999' });
  check('a player you do not have is refused', out.content.includes('roster'));
  out = await propose(env, api, 'u1', { team: '2', give: '101', get: '201', note: 'x'.repeat(10) }, { fetchRosters: async () => ({ ...rosters, tradeDeadline: NOW - 1 }) });
  check('after the deadline is refused', out.content.includes('deadline'));

  const env2 = env0(); const api2 = stubApi();
  await link(env2, 'u1', 1); await link(env2, 'u2', 2);
  env2.TRADE_VOTE_HOURS = '48';
  await propose(env2, api2, 'u1', GOOD);
  check('TRADE_VOTE_HOURS sets the length', Date.parse(env2.DB.state.trades[0].closes_at) - NOW === 48 * 3600 * 1000);

  const env3 = env0(); const api3 = stubApi();
  await link(env3, 'u1', 1);
  delete env3.TRADE_CHANNEL_ID;
  await propose(env3, api3, 'u1', GOOD);
  check('without a trade channel it posts where it was run', api3.posted[0].channel === '555');

  const env4 = env0(); const api4 = stubApi();
  await link(env4, 'u1', 1);
  await propose(env4, api4, 'u1', { ...GOOD, give2: '101', get2: '201' });
  check('two for two is stored', JSON.parse(env4.DB.state.trades[0].give).length === 2 && JSON.parse(env4.DB.state.trades[0].get).length === 2);

  const env5 = env0(); const api5 = stubApi();
  await link(env5, 'u1', 1);
  api5.failPost = true;
  check('a failed post is reported', await throws(() => propose(env5, api5, 'u1', GOOD)));
  check('and releases the players', env5.DB.state.trades[0].status === 'cancelled');
  api5.failPost = false;
  out = await propose(env5, api5, 'u1', GOOD);
  check('so the same trade can be proposed again', out.content.includes('#2'));

  out = await handleTrade(cmd('trade', 'propose', GOOD, who('u1')), {}, api, { fetchRosters: stubRosters });
  check('before setup, says so privately', out.flags === 64 && out.content.includes('not been connected'));
}

console.log('\n--- voting ---');
const press = (tradeId, vote, userId, extra = {}) => ({
  data: { custom_id: customId(tradeId, vote) }, member: who(userId), channel_id: '777', message: { id: 'm1' }, ...extra,
});
{
  const { env, api } = await setup();
  await propose(env, api, 'u1', GOOD);
  let out = await handleTradeVote(press(1, 'fair', 'u3'), env, api, { now: NOW });
  check('a vote is recorded privately', out.flags === 64 && out.content.includes('**Fair**'));
  check('the card is redrawn with the vote', api.edited.length === 1 && /Fair\s+█+\s+1/.test(api.edited[0].body.content));
  check('the redraw edits the card\'s own message', api.edited[0].id === 'm1' && api.edited[0].channel === '777');
  check('the redraw keeps the buttons', api.edited[0].body.components[0].components.length === 3);
  check('the redraw pings nobody', api.edited[0].body.allowed_mentions.parse.length === 0);
  check('the vote is stored once', env.DB.state.votes.length === 1);
  await handleTradeVote(press(1, 'robbery', 'u3'), env, api, { now: NOW });
  check('voting again changes the vote, not the count', env.DB.state.votes.length === 1 && env.DB.state.votes[0].vote === 'robbery');
  check('the card shows the changed vote', /Robbery\s+█+\s+1/.test(api.edited[1].body.content) && /Fair\s+0/.test(api.edited[1].body.content));
  await handleTradeVote(press(1, 'fair', 'u4'), env, api, { now: NOW });
  check('a second voter adds to it', env.DB.state.votes.length === 2);

  out = await handleTradeVote(press(1, 'fair', 'u1'), env, api, { now: NOW });
  check('the proposer cannot vote', out.flags === 64 && out.content.includes('part of this trade'));
  out = await handleTradeVote(press(1, 'robbery', 'u2'), env, api, { now: NOW });
  check('the other manager cannot vote', out.flags === 64 && out.content.includes('part of this trade'));
  check('neither vote was stored', env.DB.state.votes.length === 2);

  out = await handleTradeVote(press(99, 'fair', 'u5'), env, api, { now: NOW });
  check('a trade that is gone says so', out.content.includes('no longer exists'));
  out = await handleTradeVote(press(1, 'fair', 'u5'), env, api, { now: NOW + 25 * 3600 * 1000 });
  check('after the time is up, voting is closed', out.content.includes('closed'));
  env.DB.state.trades[0].status = 'vetoed';
  out = await handleTradeVote(press(1, 'fair', 'u5'), env, api, { now: NOW });
  check('after a veto, voting is closed', out.content.includes('closed'));
  out = await handleTradeVote({ data: { custom_id: 'nope' }, member: who('u5') }, env, api, { now: NOW });
  check('a stray button is refused', out.flags === 64);

  const { env: e2, api: a2 } = await setup();
  await propose(e2, a2, 'u1', GOOD);
  a2.failEdit = true;
  out = await handleTradeVote(press(1, 'fair', 'u3'), e2, a2, { now: NOW });
  check('a failed redraw still records the vote', out.content.includes('recorded') && e2.DB.state.votes.length === 1);
}

console.log('\n--- closing ---');
const LATER = NOW + 25 * 3600 * 1000;
async function voted(votes) {
  const s = await setup();
  await propose(s.env, s.api, 'u1', GOOD);
  votes.forEach(([id, vote]) => s.env.DB.state.votes.push({ trade_id: 1, user_id: id, vote, voted_at: 'x' }));
  return s;
}
{
  let { env, api } = await voted([['u3', 'fair'], ['u4', 'fair'], ['u5', 'fair']]);
  let out = await runTradeClose(env, api, { now: NOW + 1000 });
  check('nothing closes before its time', out.closed === 0 && env.DB.state.trades[0].status === 'open');
  out = await runTradeClose(env, api, { now: LATER });
  check('it closes once the time is up', out.closed === 1);
  check('approved with a clear majority', env.DB.state.trades[0].status === 'approved');
  check('the card is rewritten without buttons', api.edited.at(-1).body.components.length === 0 && api.edited.at(-1).body.content.startsWith('✅'));
  check('the result is announced in the trade\'s channel', api.posted.length === 2 && api.posted[1].channel === '777' && api.posted[1].content.includes('Approved'));
  out = await runTradeClose(env, api, { now: LATER + 60_000 });
  check('running again does nothing', out.closed === 0 && api.posted.length === 2);

  ({ env, api } = await voted([['u3', 'fair']]));
  await runTradeClose(env, api, { now: LATER });
  check('too few votes goes to the mods', env.DB.state.trades[0].status === 'no_quorum');
  check('and the announcement says so', api.posted.at(-1).content.includes('Not enough votes'));

  ({ env, api } = await voted([['u3', 'fair'], ['u4', 'fair'], ['u5', 'fair'], ['u6', 'robbery'], ['u7', 'robbery'], ['u8', 'robbery']]));
  await runTradeClose(env, api, { now: LATER });
  check('a third Robbery is flagged for the mods', env.DB.state.trades[0].status === 'flagged');
  check('and the announcement tells mods what to run', api.posted.at(-1).content.includes('/trade approve'));

  ({ env, api } = await voted([['u1', 'robbery'], ['u2', 'robbery'], ['u3', 'fair'], ['u4', 'fair'], ['u5', 'fair']]));
  await runTradeClose(env, api, { now: LATER });
  check('the managers\' stored votes are not counted', env.DB.state.trades[0].status === 'approved' && /Robbery\s+0/.test(api.edited.at(-1).body.content));

  ({ env, api } = await voted([['u3', 'fair'], ['u4', 'fair'], ['u5', 'fair']]));
  api.failEdit = true;
  check('a failed Discord call fails the run', await throws(() => runTradeClose(env, api, { now: LATER })));
  check('and the trade stays open to retry', env.DB.state.trades[0].status === 'open');
  api.failEdit = false;
  const out2 = await runTradeClose(env, api, { now: LATER });
  check('the retry closes it', out2.closed === 1 && env.DB.state.trades[0].status === 'approved');

  ({ env, api } = await voted([['u3', 'fair'], ['u4', 'fair'], ['u5', 'fair']]));
  env.DB.state.trades[0].status = 'vetoed';
  out = await runTradeClose(env, api, { now: LATER });
  check('a vetoed trade is left alone', out.closed === 0 && api.posted.length === 1);

  out = await runTradeClose({ DB: memoryDb() }, api, { now: LATER });
  check('before setup it does nothing', out.closed === 0);
}

console.log('\n--- mods and cancelling ---');
const act2 = (env, api, subName, id, member) => handleTrade(cmd('trade', subName, { trade: id }, member), env, api, { fetchRosters: stubRosters, now: NOW });
{
  let { env, api } = await voted([]);
  let out = await act2(env, api, 'veto', 1, who('u3'));
  check('a member cannot veto', out.flags === 64 && out.content.includes('Only mods'));
  out = await act2(env, api, 'approve', 1, who('u3'));
  check('a member cannot approve', out.flags === 64 && out.content.includes('Only mods'));
  check('and nothing changed', env.DB.state.trades[0].status === 'open');
  check('both are listed as mod-only', TRADE_MOD_ONLY.join() === 'approve,veto');

  out = await act2(env, api, 'veto', 1, MOD);
  check('a mod can veto', env.DB.state.trades[0].status === 'vetoed' && out.content.includes('vetoed'));
  check('the veto is public', !out.flags);
  check('the veto says the bot cannot block ESPN', out.content.includes('cannot block'));
  check('the card is closed with the veto', api.edited.at(-1).body.content.includes('Vetoed') && api.edited.at(-1).body.components.length === 0);
  out = await act2(env, api, 'approve', 1, MOD);
  check('a vetoed trade is final', out.flags === 64 && out.content.includes('already vetoed'));
  out = await act2(env, api, 'veto', 99, MOD);
  check('an unknown trade is reported', out.content.includes('no trade #99'));

  ({ env, api } = await voted([['u3', 'robbery'], ['u4', 'robbery'], ['u5', 'fair']]));
  await runTradeClose(env, api, { now: LATER });
  check('(setup) the trade was flagged', env.DB.state.trades[0].status === 'flagged');
  out = await act2(env, api, 'approve', 1, MOD);
  check('a mod can overrule a flag', env.DB.state.trades[0].status === 'approved' && out.content.includes('approved'));

  ({ env, api } = await voted([]));
  out = await act2(env, api, 'cancel', 1, who('u3'));
  check('someone else cannot cancel your proposal', out.flags === 64 && out.content.includes('proposed it'));
  out = await act2(env, api, 'cancel', 1, who('u1'));
  check('the proposer can cancel', env.DB.state.trades[0].status === 'cancelled' && out.content.includes('cancelled'));
  check('the card is closed', api.edited.at(-1).body.content.includes('Cancelled'));
  out = await act2(env, api, 'cancel', 1, who('u1'));
  check('a cancelled trade cannot be cancelled again', out.flags === 64 && out.content.includes('already cancelled'));

  ({ env, api } = await voted([]));
  out = await act2(env, api, 'cancel', 1, MOD);
  check('a mod can cancel anyone\'s', env.DB.state.trades[0].status === 'cancelled');

  ({ env, api } = await voted([['u3', 'fair'], ['u4', 'fair'], ['u5', 'fair']]));
  await runTradeClose(env, api, { now: LATER });
  out = await act2(env, api, 'cancel', 1, who('u1'));
  check('a finished vote cannot be cancelled', out.flags === 64 && out.content.includes('already approved'));

  ({ env, api } = await voted([]));
  api.failEdit = true;
  out = await act2(env, api, 'veto', 1, MOD);
  check('a failed card edit does not undo the veto', env.DB.state.trades[0].status === 'vetoed' && out.content.includes('vetoed'));
}

console.log('\n--- completed in ESPN ---');
{
  let { env, api } = await voted([['u3', 'fair'], ['u4', 'fair'], ['u5', 'fair']]);
  const quiet = { fetchActivity: async () => { throw new Error('should not ask ESPN'); } };
  let out = await runTradeSync({ ...env, DB: memoryDb() }, api, quiet);
  check('with no trades waiting, ESPN is not asked', out.completed === 0);

  const processed = [act(9, 100), act(9, 200)];
  out = await runTradeSync(env, api, { fetchActivity: async () => processed });
  check('a processed trade is completed', out.completed === 1 && env.DB.state.trades[0].status === 'completed');
  check('and its card says so', api.edited.at(-1).body.content.includes('Completed in ESPN'));

  ({ env, api } = await voted([]));
  out = await runTradeSync(env, api, { fetchActivity: async () => [act(9, 100), act(9, 300)] });
  check('a different deal with one shared player is not a match', out.completed === 0 && env.DB.state.trades[0].status === 'open');

  ({ env, api } = await voted([['u3', 'fair'], ['u4', 'fair'], ['u5', 'fair']]));
  await runTradeClose(env, api, { now: LATER });
  out = await runTradeSync(env, api, { fetchActivity: async () => processed });
  check('an approved trade completes too', env.DB.state.trades[0].status === 'completed');

  ({ env, api } = await voted([]));
  await act2(env, api, 'veto', 1, MOD);
  out = await runTradeSync(env, api, { fetchActivity: async () => { throw new Error('should not ask ESPN'); } });
  check('a vetoed trade is no longer waiting', out.completed === 0);

  ({ env, api } = await voted([]));
  api.failEdit = true;
  out = await runTradeSync(env, api, { fetchActivity: async () => processed });
  check('a failed card edit still completes it', out.completed === 1 && env.DB.state.trades[0].status === 'completed');
}

console.log('\n--- autocomplete ---');
const ac = (name, focusedName, typed, args, userId) => ({
  data: {
    name,
    options: [{
      name: name === 'trade' ? 'propose' : 'link',
      options: [
        ...Object.entries(args ?? {}).map(([k, val]) => ({ name: k, value: val })),
        { name: focusedName, value: typed, focused: true },
      ],
    }],
  },
  member: who(userId),
});
{
  const { env } = await setup();
  const run = (i) => handleFantasyAutocomplete(i, env, { fetchRosters: stubRosters });
  let c = await run(ac('trade', 'team', '', {}, 'u1'));
  check('team choices leave out your own team', c.map((x) => x.value).join() === '2,3');
  check('choice values are ids and names are labels', c[0].name === 'Ya Soul' && c[0].value === '2');
  c = await run(ac('trade', 'team', 'soul', {}, 'u1'));
  check('typing filters teams', c.length === 1 && c[0].value === '2');
  c = await run(ac('trade', 'give', '', { team: '2' }, 'u1'));
  check('give offers your own roster', c.map((x) => x.name).join() === 'Marcus Vale,Jules Okafor');
  c = await run(ac('trade', 'get', '', { team: '2' }, 'u1'));
  check('get offers the other team\'s roster', c.map((x) => x.name).join() === 'Theo Brandt,Dario Reyes');
  c = await run(ac('trade', 'get', 'dar', { team: '2' }, 'u1'));
  check('typing filters players', c.length === 1 && c[0].name === 'Dario Reyes');
  c = await run(ac('trade', 'get2', '', { team: '2', get: '200' }, 'u1'));
  check('a player already chosen is not offered again', c.map((x) => x.value).join() === '201');
  c = await run(ac('trade', 'give2', '', { team: '2', give: '100' }, 'u1'));
  check('likewise for give', c.map((x) => x.value).join() === '101');
  c = await run(ac('trade', 'get', '', {}, 'u1'));
  check('get with no team chosen yet offers nothing', c.length === 0);
  c = await run(ac('trade', 'give', '', { team: '2' }, 'u9'));
  check('give for an unlinked user offers nothing', c.length === 0);
  c = await run(ac('fantasy', 'team', '', {}, 'u9'));
  check('/fantasy link offers every team', c.length === 3);
  c = await run({ data: { name: 'trade', options: [{ name: 'propose', options: [] }] }, member: who('u1') });
  check('nothing focused, nothing offered', c.length === 0);
  check('before setup, nothing offered', (await handleFantasyAutocomplete(ac('trade', 'team', '', {}, 'u1'), {}, { fetchRosters: stubRosters })).length === 0);

  const many = { teams: [{ id: 1, name: 'A', players: Array.from({ length: 40 }, (_, i) => ({ id: i + 10, name: `P${i}` })) }], tradeDeadline: null };
  await link(env, 'u8', 1).catch(() => {});
  c = await handleFantasyAutocomplete(ac('trade', 'give', '', { team: '1' }, 'u1'), env, { fetchRosters: async () => many });
  check('never more than Discord\'s 25 choices', c.length <= 25);
  const longName = { teams: [{ id: 1, name: 'T'.repeat(300), players: [] }], tradeDeadline: null };
  c = await handleFantasyAutocomplete(ac('fantasy', 'team', '', {}, 'u1'), env, { fetchRosters: async () => longName });
  check('long names are cut to Discord\'s 100', c[0].name.length === 100);
}

console.log('\n--- the command definitions ---');
const trd = COMMANDS.find((c) => c.name === 'trade');
check('/trade is registered', Boolean(trd));
check('it offers propose, approve, veto, cancel', trd.options.map((o) => o.name).join() === 'propose,approve,veto,cancel');
check('every option is a subcommand', trd.options.every((o) => o.type === 1));
const prop = trd.options[0];
check('propose takes up to three players a side', ['give', 'give2', 'give3', 'get', 'get2', 'get3'].every((n) => prop.options.some((o) => o.name === n)));
check('the first player each side is required', prop.options.filter((o) => o.required).map((o) => o.name).join() === 'team,give,get');
check('required options come first', (() => { const r = prop.options.map((o) => Boolean(o.required)); return r.indexOf(false) === -1 || !r.slice(r.indexOf(false)).includes(true); })());
check('team and players autocomplete', prop.options.filter((o) => o.name !== 'note').every((o) => o.autocomplete === true));
check('the note is capped', prop.options.find((o) => o.name === 'note').max_length === 200);
check('approve, veto and cancel take a trade number', trd.options.slice(1).every((o) => o.options[0].name === 'trade' && o.options[0].type === 4 && o.options[0].required));
const fl = COMMANDS.find((c) => c.name === 'fantasy').options.find((o) => o.name === 'link');
check('/fantasy link exists, with autocomplete', fl && fl.options[0].autocomplete === true);
check('its user option is optional', fl.options[1].required === false);
// Discord rejects an uppercase command or option name. Choice labels (like
// /lfg's "CoD") are display text and may have capitals, so only walk names.
const namesOf = (nodes) => (nodes ?? []).flatMap((n) => [n.name, ...namesOf(n.options)]);
check('command and option names are lowercase', namesOf(COMMANDS).every((n) => n === n.toLowerCase()));
check('and use only letters, digits and underscores', namesOf(COMMANDS).every((n) => /^[a-z0-9_-]{1,32}$/.test(n)));

if (fails.length) { console.log(`\n${fails.length} FAILED`); process.exit(1); }
console.log('\nall trade checks passed');
