/**
 * The live board for the league's real ESPN draft.
 *
 * ESPN's draft payload is hand-built here in the shape this bot assumes, so
 * these tests prove the board follows it correctly, announces each pick once,
 * and survives failures. Whether ESPN really sends that shape is what
 * /fantasy debug's "Real draft" line is for.
 */

import { parseLiveDraft, fetchLiveDraft, clearNameCache, fetchDraftPoolCached, clearPoolCache } from './fantasy.mjs';
import { boardEmbed, liveOrderEmbed, liveComponents, parseCustomId, pickLine, clockLine, rosterEmbed, roundEmbed } from './draft.mjs';
import worker, { handleDraft, handleDraftButton, runLiveDraft, DRAFT_CRON, handleFantasy } from './index.mjs';
import { getLiveDraft } from './db.mjs';
import { COMMANDS } from '../../shared/commands.mjs';
import { memoryDb, stubApi, who, MOD, cmd } from './test-db.mjs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };
const flat = (e) => [e.title, e.description ?? '', ...(e.fields ?? []).flatMap((f) => [f.name, f.value]), e.footer?.text ?? ''].join('\n');

// ------------------------------------------------------------ reading ESPN
console.log('--- reading ESPN\'s draft ---');
const raw = (over = {}) => ({
  draftDetail: {
    drafted: false, inProgress: true,
    picks: [
      { overallPickNumber: 2, roundId: 1, teamId: 1, playerId: 1001, autoDraftTypeId: 1 },
      { overallPickNumber: 1, roundId: 1, teamId: 3, playerId: 1000, autoDraftTypeId: 0 },
      { overallPickNumber: 3, roundId: 1, teamId: 4, playerId: 1002, keeper: true },
      { overallPickNumber: 9, roundId: 3, teamId: 2 },
      { teamId: 2, playerId: 1003, roundId: 1 },
    ],
    ...over.draftDetail,
  },
  settings: {
    draftSettings: { type: 'SNAKE', timePerSelection: 75, date: Date.parse('2027-10-20T23:00:00Z'), pickOrder: [3, 1, 4, 2] },
    rosterSettings: { lineupSlotCounts: { 0: 1, 1: 1, 11: 3, 12: 3, bad: 'x' } },
    ...over.settings,
  },
});
let d = parseLiveDraft(raw());
check('picks are in pick order', d.picks.map((p) => p.pickNo).join() === '1,2,3,4');
check('a pick with no player is dropped, one with no number is numbered by its place', d.picks.length === 4 && d.picks[3].playerId === 1003);
check('who made each pick and which player', d.picks[0].teamId === 3 && d.picks[0].playerId === 1000 && d.picks[1].teamId === 1);
check('auto and keeper flags', d.picks[1].auto === true && d.picks[0].auto === false && d.picks[2].keeper === true);
check('the pick order, pick time, start time, type', d.order.join() === '3,1,4,2' && d.secondsPerPick === 75 && d.date === Date.parse('2027-10-20T23:00:00Z') && d.type === 'SNAKE');
check('rounds come from the roster slots', d.slots === 8);
check('in progress means live', d.phase === 'live');
check('drafted means done', parseLiveDraft(raw({ draftDetail: { drafted: true } })).phase === 'done');
check('nothing yet means waiting', parseLiveDraft(raw({ draftDetail: { inProgress: false, picks: [] } })).phase === 'waiting');
check('picks without the flag still mean live', parseLiveDraft(raw({ draftDetail: { inProgress: false } })).phase === 'live');
const bare = parseLiveDraft({ draftDetail: {} });
check('missing settings are nulls, not crashes', bare.order.length === 0 && bare.secondsPerPick === null && bare.date === null && bare.slots === null && bare.phase === 'waiting');
let threw = false;
try { parseLiveDraft({}); } catch { threw = true; }
check('no draftDetail at all is an error', threw);

console.log('\n--- names for the picks ---');
clearNameCache();
const cfg = { leagueId: '1', season: 2027, espnS2: 's', swid: '{x}' };
const calls = [];
const route = async (url, init) => {
  calls.push({ url, filter: init.headers['x-fantasy-filter'] });
  if (url.includes('/players')) return { ok: true, status: 200, json: async () => [{ id: 1002, fullName: 'Looked Up' }] };
  return { ok: true, status: 200, json: async () => raw() };
};
const pool = [{ id: 1000, name: 'Player 01', position: 'C', proTeam: 'LAL', adp: 1 }, { id: 1001, name: 'Player 02', position: 'PG', proTeam: 'NYK', adp: 2 }];
let live = await fetchLiveDraft(cfg, { pool, fetchImpl: route });
check('a pooled player has name, position and team', live.picks[0].name === 'Player 01' && live.picks[0].position === 'C' && live.picks[0].proTeam === 'LAL');
check('one outside the pool is looked up by id', live.picks[2].name === 'Looked Up' && live.picks[2].position === '');
check('only the unknown ids were asked for', JSON.parse(calls.find((c) => c.url.includes('/players')).filter).players.filterIds.value.join() === '1002,1003');
check('one that cannot be found still appears on the board', live.picks[3].name === 'Player 1003');
const before = calls.length;
await fetchLiveDraft(cfg, { pool, fetchImpl: route });
check('a name found once is not asked for again', calls.filter((c) => c.url.includes('/players')).length === 1 && calls.length === before + 1);
clearNameCache();
live = await fetchLiveDraft(cfg, { pool, fetchImpl: async (url) => (url.includes('/players') ? { ok: false, status: 500, json: async () => ({}) } : { ok: true, status: 200, json: async () => raw() }) });
check('a failed name lookup does not lose the picks', live.picks.length === 4 && live.picks[2].name === 'Player 1002');
check('it asks the draft view', calls[0].url.includes('view=mDraftDetail') && calls[0].url.includes('view=mSettings'));
clearPoolCache();
let n = 0;
const poolFetch = async () => { n += 1; return { ok: true, status: 200, json: async () => ({ players: [{ player: { id: 1, fullName: 'A', ownership: { averageDraftPosition: 3 } } }] }) }; };
await fetchDraftPoolCached(cfg, { fetchImpl: poolFetch });
await fetchDraftPoolCached(cfg, { fetchImpl: poolFetch, now: Date.now() + 60_000 });
check('the pool is fetched once for a while', n === 1);
await fetchDraftPoolCached(cfg, { fetchImpl: poolFetch, now: Date.now() + 1_000_000 });
check('and again after a quarter of an hour', n === 2);

// ------------------------------------------------------------------- boards
console.log('\n--- what the board looks like ---');
const seats = [
  { teamId: 3, name: 'Charlie', userId: 'u3', live: true },
  { teamId: 1, name: 'Alpha', userId: null, live: true },
  { teamId: 4, name: 'Delta', userId: 'u4', live: true },
  { teamId: 2, name: 'Bravo', userId: null, live: true },
];
const draft = { id: 'live', live: true, status: 'running', rounds: 8, seats, clockSeconds: 75, deadline: null, pickNo: 4 };
const picks = [
  { pickNo: 1, teamId: 3, name: 'Player 01', position: 'C', proTeam: 'LAL', auto: false },
  { pickNo: 2, teamId: 1, name: 'Player 02', position: 'PG', proTeam: 'NYK', auto: true },
  { pickNo: 3, teamId: 4, name: 'Player 03', position: 'SG', proTeam: 'BKN', auto: false },
];
const best = [{ id: 7, name: 'Player 07', position: 'PF', proTeam: 'MIA', adp: 7 }];
let e = boardEmbed({ draft, recent: picks.slice().reverse(), best });
check('titled live with the round and pick', e.title === 'Live draft · Round 1 · Pick 4 of 32');
check('the team on the clock, and the person if linked', flat(e).includes('**On the clock:** Bravo'));
check('a team nobody linked is not called a bot', !flat(e).includes('(bot)') && !flat(e).includes('(b)'));
check('there is no countdown, and it says why', flat(e).includes('75 seconds a pick') && flat(e).includes('does not share the countdown') && !flat(e).includes('<t:'));
check('it says to pick in ESPN, not here', e.footer.text.includes('Make your pick in ESPN') && !flat(e).includes('practice'));
check('best available and recent picks are shown', flat(e).includes('Player 07') && flat(e).includes('Player 03'));
e = boardEmbed({ draft: { ...draft, pickNo: 1 }, recent: [], best });
check('a person on the clock is mentioned', flat(e).includes('**On the clock:** <@u3> · Charlie'));
e = boardEmbed({ draft: { ...draft, status: 'done', pickNo: 33 }, recent: picks, best: [] });
check('a finished draft', e.title === 'The draft is done' && flat(e).includes('8 rounds, 32 picks') && e.footer.text === 'Mirrored from ESPN.');
e = liveOrderEmbed({ draft: { ...draft, status: 'lobby' }, date: Date.parse('2027-10-20T23:00:00Z') });
const t = Math.floor(Date.parse('2027-10-20T23:00:00Z') / 1000);
check('before it starts: when, and the order', e.title === 'The draft has not started' && flat(e).includes(`<t:${t}:F>`) && flat(e).includes(`<t:${t}:R>`) && /│\s+1\s+│\s+Charlie\s+│\s+linked\s+│/.test(flat(e)) && /│\s+2\s+│\s+Alpha\s+│\s+—\s+│/.test(flat(e)));
check('with no time or order set it says so', flat(liveOrderEmbed({ draft: { ...draft, seats: [] }, date: null })).includes('has not set a time') && flat(liveOrderEmbed({ draft: { ...draft, seats: [] }, date: null })).includes('has not set the order'));
check('lines for picks: normal, auto-drafted, and pings', pickLine(picks[0], seats[0]) === 'Pick 1: Charlie drafted Player 01 (C, LAL)' && pickLine(picks[1], seats[1]) === 'Pick 2: Alpha was auto-drafted Player 02 (PG, NYK)');
check('the clock line uses ESPN\'s time and promises no countdown', clockLine(draft, seats[0]) === '<@u3>, you\'re on the clock for pick 4. You have 75 seconds in ESPN.' && clockLine({ ...draft, clockSeconds: null }, seats[0]) === '<@u3>, you\'re on the clock for pick 4.');
check('the roster view has no practice footer', rosterEmbed({ draft, seatIndex: 0, picks }).footer === undefined);
check('buttons: roster and board only, no pick button', liveComponents()[0].components.map((c) => c.custom_id).join() === 'dr:live:roster,dr:live:board');
check('and the id parses', JSON.stringify(parseCustomId('dr:live:round:3')) === '{"draftId":"live","action":"round","arg":3}' && parseCustomId('dr:live:join') !== null && parseCustomId('dr:liv:board') === null);

// ----------------------------------------------------------------- running
const teams = [1, 2, 3, 4].map((id) => ({ id, name: ['Alpha', 'Bravo', 'Charlie', 'Delta'][id - 1], players: [] }));
const bigPool = Array.from({ length: 40 }, (_, i) => ({ id: 1000 + i, name: `Player ${String(i + 1).padStart(2, '0')}`, position: 'C', proTeam: 'LAL', adp: i + 1 }));
const NOW = Date.parse('2027-10-20T23:00:00Z');

/** A fake ESPN: change `espn` and the next minute sees it. */
function setup({ phase = 'waiting', made = 0 } = {}) {
  const env = { FANTASY_LEAGUE_ID: '1', FANTASY_SEASON: '2027', DB: memoryDb() };
  const api = stubApi();
  const espn = { phase, made, order: [3, 1, 4, 2], slots: 8, secondsPerPick: 75, date: NOW, fail: false, calls: 0 };
  const orderOf = (pickNo) => {
    const r = Math.floor((pickNo - 1) / 4); const i = (pickNo - 1) % 4;
    return espn.order[r % 2 === 0 ? i : 3 - i];
  };
  const deps = {
    now: NOW,
    fetchRosters: async () => ({ teams }),
    fetchPool: async () => bigPool,
    fetchLive: async () => {
      espn.calls += 1;
      if (espn.fail) throw new Error('ESPN 503');
      return {
        phase: espn.phase, order: espn.order, slots: espn.slots, secondsPerPick: espn.secondsPerPick, date: espn.date, type: 'SNAKE',
        picks: Array.from({ length: espn.made }, (_, i) => ({
          pickNo: i + 1, teamId: orderOf(i + 1), playerId: 1000 + i, auto: i === 1, keeper: false, ...{ name: bigPool[i].name, position: 'C', proTeam: 'LAL' },
        })),
      };
    },
  };
  const link = (u, teamId) => handleFantasy(cmd('fantasy', 'link', { team: String(teamId) }, who(u)), env, { fetchRosters: async () => ({ teams }) });
  const run = (sub, args, member = MOD, over = {}) => handleDraft(cmd('draft', sub, args, member), env, api, { ...deps, ...over });
  const tick = (over = {}) => runLiveDraft(env, api, { ...deps, ...over });
  const press = (id, u) => handleDraftButton({ data: { custom_id: id }, member: who(u), channel_id: '555' }, env, api, deps);
  return { env, api, espn, deps, link, run, tick, press };
}
const lastPost = (api) => api.posted[api.posted.length - 1];
const lastEdit = (api) => api.edited[api.edited.length - 1];

console.log('\n--- starting the board ---');
{
  const { env, api, espn, run } = setup();
  let out = await run('live', {}, who('u1'));
  check('a member cannot start it', out.content.includes('Only mods') && api.posted.length === 0);
  out = await run('live-off', {}, who('u1'));
  check('nor stop it', out.content.includes('Only mods'));
  out = await run('live', {});
  check('a mod starts it and is told where, and how many rounds', out.flags === 64 && out.content.includes('<#555>') && out.content.includes('Rounds: 8') && out.content.includes('from the league’s roster slots'));
  check('before the draft the board shows the order, with no buttons', api.posted.length === 1 && api.posted[0].extra.embeds[0].title === 'The draft has not started' && api.posted[0].extra.components.length === 0);
  const row = await getLiveDraft(env.DB, 2027);
  check('it is stored against the season and the message', row.channelId === '555' && row.messageId === 'm1' && row.status === 'watching' && row.phase === 'waiting' && row.pickCount === 0 && row.rounds === null);
  espn.order = [];
  out = await run('live', {});
  check('without an order it says so', out.content.includes('has not set the pick order'));
  check('a second start moves the board and retires the old one', api.posted.length === 2 && api.edited.length === 1 && api.edited[0].id === 'm1' && api.edited[0].body.embeds[0].title === 'This board moved');
  out = await run('live', { rounds: 31 });
  check('silly rounds are refused', out.content.includes('between 1 and 30') && api.posted.length === 2);
  out = await run('live', { rounds: 12 });
  check('a rounds override is kept and not described as a guess', (await getLiveDraft(env.DB, 2027)).rounds === 12 && out.content.includes('Rounds: 12.') && !out.content.includes('roster slots'));
  const b = await handleDraft(cmd('draft', 'live', {}, MOD), {}, api, {});
  check('before setup it says so privately', b.content.includes('not been connected'));
  espn.fail = true;
  let t2 = false;
  try { await run('live', {}); } catch { t2 = true; }
  check('if ESPN cannot be read it is an error, and nothing is posted', t2 && api.posted.length === 3);
  out = await run('live-off', {});
  check('stopping edits the board and ends the watch', out.content.includes('Stopped') && lastEdit(api).body.embeds[0].title === 'The live board was stopped' && (await getLiveDraft(env.DB, 2027)).status === 'stopped');
  check('and stopping twice is harmless', (await run('live-off', {})).content.includes('not running'));
}

console.log('\n--- a draft under way ---');
{
  const { env, api, espn, run, tick, link } = setup();
  await link('u3', 3); await link('u2', 2);
  await run('live', {});
  api.posted.length = 0; api.edited.length = 0;
  let out = await tick();
  check('nothing new: one ESPN call, no Discord call', out.picks === 0 && out.checked === 1 && api.edited.length === 0 && api.posted.length === 0 && espn.calls === 2);

  espn.phase = 'live';
  out = await tick();
  check('the draft starting turns the board over and says so', api.edited.length === 1 && lastEdit(api).body.embeds[0].title === 'Live draft · Round 1 · Pick 1 of 32' && lastEdit(api).body.components[0].components.length === 2);
  check('and pings the first team if someone linked it', lastPost(api).content.includes('The draft has started.') && lastPost(api).content.includes('<@u3>, you\'re on the clock for pick 1') && lastPost(api).mentions.users.join() === 'u3');
  check('the board message is the one that was posted', lastEdit(api).id === 'm1' && lastEdit(api).channel === '555');

  api.posted.length = 0; api.edited.length = 0;
  espn.made = 1;
  out = await tick();
  check('a pick is announced once and the board redrawn', out.picks === 1 && api.posted.length === 1 && api.edited.length === 1);
  check('naming the player and the team', lastPost(api).content.startsWith('Pick 1: Charlie drafted Player 01 (C, LAL)'));
  check('the next team has no linked person, so no ping', !lastPost(api).content.includes('on the clock') && (lastPost(api).mentions.users ?? []).length === 0);
  check('the pick count is stored', (await getLiveDraft(env.DB, 2027)).pickCount === 1);
  api.posted.length = 0; api.edited.length = 0;
  out = await tick();
  check('the same state a minute later says nothing', out.picks === 0 && api.posted.length === 0 && api.edited.length === 0);

  espn.made = 5;
  out = await tick();
  const lines = lastPost(api).content.split('\n');
  check('several picks in one minute become one message, in order', out.picks === 4 && api.posted.length === 1 && lines[0].startsWith('Pick 2:') && lines[3].startsWith('Pick 5:'));
  check('an auto-draft is called that', lines[0] === 'Pick 2: Alpha was auto-drafted Player 02 (C, LAL)');
  check('pick 6 is Delta, who nobody linked, so nobody is pinged', !lines.some((l) => l.includes('on the clock')));
  espn.made = 7;
  api.posted.length = 0;
  await tick();
  check('the linked person on the clock (pick 8 is Charlie) is pinged by name', api.posted.length === 1 && lastPost(api).content.includes('<@u3>, you\'re on the clock for pick 8') && lastPost(api).mentions.users.join() === 'u3');

  api.posted.length = 0; api.edited.length = 0;
  espn.made = 32; espn.phase = 'done';
  out = await tick();
  check('the last pick is announced with the end', out.picks === 25 && lastPost(api).content.includes('That was the last pick. The draft is done.'));
  check('only the latest picks are listed, with a note about the rest', lastPost(api).content.startsWith('…10 earlier picks are on the board.'));
  check('the final board has only a full-board view', lastEdit(api).body.embeds[0].title === 'The draft is done' && lastEdit(api).body.components[0].components.length === 2);
  check('and the watch ends itself', (await getLiveDraft(env.DB, 2027)).status === 'done');
  api.posted.length = 0; espn.calls = 0;
  out = await tick();
  check('after that ESPN is not asked at all', out.checked === 0 && espn.calls === 0 && api.posted.length === 0);
}

console.log('\n--- joining a draft already going ---');
{
  const { env, api, espn, run, tick } = setup({ phase: 'live', made: 12 });
  await run('live', {});
  check('the board starts from where the draft is', api.posted[0].extra.embeds[0].title === 'Live draft · Round 4 · Pick 13 of 32');
  api.posted.length = 0; api.edited.length = 0;
  await tick();
  check('and the picks already made are not replayed', api.posted.length === 0 && (await getLiveDraft(env.DB, 2027)).pickCount === 12);
  espn.made = 13;
  await tick();
  check('only what happens next', api.posted.length === 1 && lastPost(api).content === 'Pick 13: Bravo drafted Player 13 (C, LAL)');
}

console.log('\n--- when things go wrong ---');
{
  const { env, api, espn, run, tick, link } = setup({ phase: 'live' });
  await link('u3', 3);
  await run('live', {});
  espn.made = 1;
  api.failEdit = true; api.failPost = true;
  let out = await tick();
  check('Discord failing does not throw', out.picks === 1);
  check('and the pick is still saved', (await getLiveDraft(env.DB, 2027)).pickCount === 1);
  api.failEdit = false; api.failPost = false; api.posted.length = 0; api.edited.length = 0;
  out = await tick();
  check('so it is not announced a second time', out.picks === 0 && api.posted.length === 0);
  espn.fail = true;
  let threw2 = false;
  try { await tick(); } catch { threw2 = true; }
  check('ESPN failing fails the run so it shows in the logs', threw2);
  check('and nothing was lost', (await getLiveDraft(env.DB, 2027)).pickCount === 1);
  espn.fail = false; espn.made = 2;
  out = await tick();
  check('the next minute carries on', out.picks === 1 && lastPost(api).content.includes('Pick 2'));
  check('with no league connected the job does nothing', (await runLiveDraft({ DB: memoryDb() }, api, {})).checked === 0);
  const other = setup({ phase: 'live' });
  await other.run('live', {});
  other.env.DB.state.live[0].season = 2026;
  check('a board for another season is left alone', (await other.tick()).checked === 0);
}

console.log('\n--- the private views ---');
{
  const { api, espn, run, link, press } = setup({ phase: 'live', made: 6 });
  await link('u3', 3);
  await run('live', {});
  let out = await press('dr:live:roster', 'u3');
  check('my roster is private and lists my picks', out.update === false && out.data.flags === 64 && flat(out.data.embeds[0]).includes('Roster · Charlie') && flat(out.data.embeds[0]).includes('Player 01'));
  out = await press('dr:live:roster', 'u9');
  check('someone who has not linked is told how', out.data.content.includes('/fantasy link'));
  await link('u9', 2);
  out = await press('dr:live:roster', 'u9');
  check('a linked team with picks of its own', flat(out.data.embeds[0]).includes('Roster · Bravo'));
  out = await press('dr:live:board', 'u9');
  check('the full board opens at the current round', out.update === false && out.data.embeds[0].title === 'Round 2 of 8' && out.data.components[0].components.length === 3);
  check('and runs in reverse on even rounds', flat(out.data.embeds[0]).includes('reverse'));
  out = await press('dr:live:round:1', 'u9');
  check('paging rewrites the same message', out.update === true && out.data.embeds[0].title === 'Round 1 of 8' && out.data.components[0].components[0].custom_id === 'dr:live:round:0');
  out = await press('dr:live:round:99', 'u9');
  check('past the end is clamped', out.data.embeds[0].title === 'Round 8 of 8');
  espn.order = [];
  out = await press('dr:live:board', 'u9');
  check('with no order there is nothing to show', out.data.content.includes('has not set the pick order'));
  const none = setup({ phase: 'live', made: 6 });
  out = await none.press('dr:live:board', 'u9');
  check('with no board running it says so', out.data.content.includes('no live board'));
}

console.log('\n--- the minute job ---');
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('no network in tests'); };
  const errs = []; const origErr = console.error; console.error = (...a) => errs.push(a.join(' '));
  let routed = true;
  try { await worker.scheduled({ cron: DRAFT_CRON }, { DISCORD_TOKEN: 't', DB: memoryDb() }); } catch { routed = false; }
  check('with nothing to do it completes without any network', routed);
  const env = { DISCORD_TOKEN: 't', FANTASY_LEAGUE_ID: '1', FANTASY_SEASON: '2027', DB: memoryDb() };
  env.DB.state.live.push({ season: 2027, channel_id: '5', message_id: 'm', status: 'watching', rounds: null, pick_count: 0, phase: '', created_by: 'x', updated_at: '' });
  let failed = false;
  try { await worker.scheduled({ cron: DRAFT_CRON }, env); } catch (err) { failed = err.message.startsWith('live:'); }
  console.error = origErr; globalThis.fetch = realFetch;
  check('a live-board failure fails the invocation, labelled', failed);
}

console.log('\n--- the command ---');
const dc = COMMANDS.find((c) => c.name === 'draft');
const lv = dc.options.find((o) => o.name === 'live');
check('/draft live takes an optional rounds', lv.type === 1 && lv.options.length === 1 && lv.options[0].name === 'rounds' && !lv.options[0].required && lv.options[0].max_value === 30);
check('/draft live-off exists', dc.options.some((o) => o.name === 'live-off' && o.type === 1));
check('descriptions fit Discord\'s 100', dc.options.every((o) => [...o.description].length <= 100 && (o.options ?? []).every((x) => [...x.description].length <= 100)));
check('at most 25 subcommands', dc.options.length <= 25);

if (fails.length) { console.log(`\n${fails.length} FAILED`); process.exit(1); }
console.log('\nall live draft checks passed');
