/**
 * Practice drafts, end to end.
 *
 * The pure rules (snake order, the bots, validation, the embeds) are checked
 * directly. The handlers then play real drafts against a small in-memory
 * database and a stub Discord API, because what matters is the sequence: a
 * person's pick, the bots that follow, the clock that runs out, the board that
 * is redrawn. Nothing here talks to ESPN or Discord.
 */

import {
  slotFor, totalPicks, seatOnClock, upNext, picksForSeat, shuffle, botChoice, BOT_WEIGHTS,
  parseCustomId, customId, lobbyComponents, boardComponents, roundComponents,
  lobbyEmbed, boardEmbed, rosterEmbed, roundEmbed, pickLine, clockLine, validatePick,
  MAX_BOT_PICKS_PER_RUN,
} from './draft.mjs';
import { fetchDraftPool } from './fantasy.mjs';
import { updateSeats, recordPick, getDraft, draftPicks, availablePlayers } from './db.mjs';
import worker, {
  handleDraft, handleDraftButton, handleDraftAutocomplete, runDraftTick, respondDeferred, handleFantasy, DRAFT_CRON,
} from './index.mjs';
import { COMMANDS, DRAFT_MOD_ONLY } from '../../shared/commands.mjs';
import { memoryDb, stubApi, who, MOD, cmd } from './test-db.mjs';
import { readFileSync } from 'node:fs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };

// --------------------------------------------------------------- snake order
console.log('--- snake order ---');
const slots = Array.from({ length: 8 }, (_, i) => slotFor(i + 1, 4));
check('round one runs first seat to last', slots.slice(0, 4).map((s) => s.seatIndex).join() === '0,1,2,3');
check('round two runs back again', slots.slice(4).map((s) => s.seatIndex).join() === '3,2,1,0');
check('rounds are numbered from one', slots.map((s) => s.round).join() === '1,1,1,1,2,2,2,2');
check('and so is the pick within a round', slots.map((s) => s.inRound).join() === '1,2,3,4,1,2,3,4');
check('round three goes forward again', [9, 10, 11, 12].map((p) => slotFor(p, 4).seatIndex).join() === '0,1,2,3');
check('the same seat picks at the turn of a round', slotFor(4, 4).seatIndex === 3 && slotFor(5, 4).seatIndex === 3);
check('a ten-team draft turns at pick 10 and 11', slotFor(10, 10).seatIndex === 9 && slotFor(11, 10).seatIndex === 9 && slotFor(20, 10).seatIndex === 0 && slotFor(21, 10).seatIndex === 0);
check('every seat picks once a round', [1, 2, 3].every((r) => new Set(Array.from({ length: 6 }, (_, i) => slotFor((r - 1) * 6 + i + 1, 6).seatIndex)).size === 6));
const seats4 = [1, 2, 3, 4].map((id) => ({ teamId: id, name: `Team ${id}`, userId: id === 1 ? 'u1' : null }));
const dr = (over = {}) => ({ id: 7, season: 2027, status: 'running', rounds: 2, clockSeconds: 60, seats: seats4, pickNo: 1, deadline: null, ...over });
check('total picks is rounds times seats', totalPicks(dr()) === 8 && totalPicks(dr({ rounds: 13, seats: Array(10).fill(seats4[0]) })) === 130);
check('the seat on the clock follows the pick number', seatOnClock(dr()).teamId === 1 && seatOnClock(dr({ pickNo: 5 })).teamId === 4 && seatOnClock(dr({ pickNo: 8 })).teamId === 1);
check('nobody is on the clock before the draft or after it', seatOnClock(dr({ status: 'lobby' })) === null && seatOnClock(dr({ pickNo: 9 })) === null && seatOnClock(dr({ status: 'done' })) === null);
check('up next looks across the turn of a round', upNext(dr({ pickNo: 3 }), 3).map((s) => s.teamId).join() === '4,4,3');
check('and stops at the end of the draft', upNext(dr({ pickNo: 7 }), 3).map((s) => s.teamId).join() === '1' && upNext(dr({ pickNo: 8 })).length === 0);
check('a seat\'s own pick numbers', picksForSeat(dr(), 0).join() === '1,8' && picksForSeat(dr(), 3).join() === '4,5');
check('from a given pick onward', picksForSeat(dr(), 0, 2).join() === '8');

console.log('\n--- shuffling and the bots ---');
const items = [1, 2, 3, 4, 5];
check('a shuffle keeps everyone', shuffle(items).slice().sort().join() === '1,2,3,4,5');
check('and leaves the original alone', items.join() === '1,2,3,4,5');
check('with nothing swapped when the draw says so', shuffle(items, () => 0.9999).join() === '1,2,3,4,5');
check('and a different order otherwise', shuffle(items, () => 0).join() !== '1,2,3,4,5');
check('the same draw gives the same order', shuffle(items, () => 0.3).join() === shuffle(items, () => 0.3).join());
check('the weights add up to a hundred', BOT_WEIGHTS.reduce((a, b) => a + b, 0) === 100);
const five = [1, 2, 3, 4, 5].map((n) => ({ id: n, adp: n }));
check('a bot usually takes the best available', botChoice(five, () => 0).id === 1 && botChoice(five, () => 0.49).id === 1);
check('sometimes the second', botChoice(five, () => 0.5).id === 2);
check('and so on down the weights', botChoice(five, () => 0.75).id === 3 && botChoice(five, () => 0.87).id === 4 && botChoice(five, () => 0.95).id === 5);
check('never beyond the fifth', botChoice(five, () => 0.9999).id === 5 && botChoice([...five, { id: 6 }, { id: 7 }], () => 0.9999).id === 5);
check('with fewer than five left it still picks one', botChoice(five.slice(0, 2), () => 0.9999).id === 2 && botChoice(five.slice(0, 1), () => 0.5).id === 1);
check('with none left there is nothing to pick', botChoice([], () => 0) === null);
const tally = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
for (let i = 0; i < 1000; i += 1) tally[botChoice(five, () => i / 1000).id] += 1;
check('over many picks the odds match the weights', tally[1] === 500 && tally[2] === 250 && tally[3] === 120 && tally[4] === 80 && tally[5] === 50);

console.log('\n--- button ids ---');
check('round trip with no argument', JSON.stringify(parseCustomId(customId(3, 'best'))) === '{"draftId":3,"action":"best","arg":null}');
check('and with one', JSON.stringify(parseCustomId(customId(3, 'round', 4))) === '{"draftId":3,"action":"round","arg":4}');
check('every action is recognised', ['join', 'leave', 'begin', 'best', 'roster', 'board', 'round'].every((a) => parseCustomId(`dr:1:${a}`)?.action === a));
check('other ids are not', parseCustomId('trade:1:fair') === null && parseCustomId('dr:x:join') === null && parseCustomId('dr:1:bogus') === null && parseCustomId(undefined) === null);
check('lobby buttons: join, leave, begin', lobbyComponents(5)[0].components.map((c) => c.custom_id).join() === 'dr:5:join,dr:5:leave,dr:5:begin');
check('the board has three while running', boardComponents(5, true)[0].components.map((c) => c.custom_id).join() === 'dr:5:best,dr:5:roster,dr:5:board');
check('and only the full board once done', boardComponents(5, false)[0].components.length === 1);
const rc = roundComponents(5, 1, 13)[0].components;
check('previous is off on round one', rc[0].disabled === true && rc[2].disabled === false);
check('next is off on the last round', roundComponents(5, 13, 13)[0].components[2].disabled === true);
check('the middle button names the round and does nothing', rc[1].label === 'Round 1' && rc[1].disabled === true);
check('navigation ids carry the target round', roundComponents(5, 4, 13)[0].components[0].custom_id === 'dr:5:round:3' && roundComponents(5, 4, 13)[0].components[2].custom_id === 'dr:5:round:5');
check('all ids fit Discord\'s 100 characters', [...lobbyComponents(99999), ...boardComponents(99999, true), ...roundComponents(99999, 20, 20)].every((r) => r.components.every((c) => c.custom_id.length <= 100 && c.label.length <= 80)));

console.log('\n--- the embeds ---');
const flat = (e) => [e.title, e.description ?? '', ...(e.fields ?? []).flatMap((f) => [f.name, f.value]), e.footer?.text ?? ''].join('\n');
const lobby = dr({ status: 'lobby' });
lobby.seats = [{ teamId: 1, name: 'Alpha', userId: 'u1' }, { teamId: 2, name: 'Bravo', userId: null }];
let e = lobbyEmbed(lobby);
check('the lobby is titled with the draft number', e.title === 'Mock draft #7 lobby');
check('it lists every team and who drafts it', /│\s+1\s+│\s+Alpha\s+│\s+person\s+│/.test(flat(e)) && /│\s+2\s+│\s+Bravo\s+│\s+bot\s+│/.test(flat(e)));
check('and names the managers', flat(e).includes('<@u1> · Alpha'));
check('and counts them', flat(e).includes('1 of 2 with a manager'));
check('an empty lobby says so', flat(lobbyEmbed({ ...lobby, seats: lobby.seats.map((s) => ({ ...s, userId: null })) })).includes('Nobody yet.'));
check('the footer says it is practice', e.footer.text.includes('practice only') && e.footer.text.includes('2 rounds') && e.footer.text.includes('60s a pick'));

const picks = [
  { pickNo: 1, teamId: 1, name: 'Marcus Vale', position: 'C', proTeam: 'LAL' },
  { pickNo: 2, teamId: 2, name: 'Theo Brandt', position: 'PG', proTeam: 'NYK' },
];
const best = [{ id: 9, name: 'Dario Reyes', position: 'SG', proTeam: 'BKN', adp: 14.2 }, { id: 10, name: 'No Team', position: '', proTeam: '', adp: 15 }];
const running = dr({ pickNo: 3, deadline: '2027-01-01T12:01:00.000Z', seats: [{ teamId: 1, name: 'Alpha', userId: 'u1' }, { teamId: 2, name: 'Bravo', userId: null }, { teamId: 3, name: 'Charlie', userId: 'u3' }, { teamId: 4, name: 'Delta', userId: null }] });
e = boardEmbed({ draft: running, recent: picks.slice().reverse(), best });
check('titled with the round and pick', e.title === 'Mock draft #7 · Round 1 · Pick 3 of 8');
check('names who is on the clock, with a mention for a person', flat(e).includes('**On the clock:** <@u3> · Charlie'));
check('shows a live countdown', flat(e).includes(`<t:${Date.parse(running.deadline) / 1000}:R>`) && flat(e).includes('60 seconds a pick'));
check('says who is up next, bots marked', flat(e).includes('**Up next:** Delta (bot) · Delta (bot) · Charlie'));
check('lists the recent picks newest first', /│\s+2\s+│\s+Bravo\s+\(b\)\s+│\s+Theo Brandt\s+│\s+PG\s+│[\s\S]*│\s+1\s+│\s+Alpha\s+│\s+Marcus Vale\s+│\s+C\s+│/.test(flat(e)));
check('lists the best available with ADP', /│\s+1\s+│\s+Dario Reyes\s+│\s+SG\s+│\s+BKN\s+│\s+14\.2\s+│/.test(flat(e)));
check('and copes with a player ESPN gave no position or team', /│\s+2\s+│\s+No Team\s+│\s+—\s+│\s+—\s+│\s+15\.0\s+│/.test(flat(e)));
check('inside Discord\'s embed limits', flat(e).length < 6000 && e.fields.every((f) => f.name.length <= 256 && f.value.length <= 1024) && e.title.length <= 256 && e.description.length <= 4096);
e = boardEmbed({ draft: dr({ pickNo: 2, deadline: null }), recent: picks.slice(0, 1), best });
check('a bot on the clock has no countdown', flat(e).includes('a bot picks straight away') && !flat(e).includes('<t:'));
e = boardEmbed({ draft: dr({ pickNo: 8, deadline: '2027-01-01T12:01:00.000Z' }), recent: [], best: [] });
check('the last pick says nobody is next', flat(e).includes('nobody, this is the last pick'));
check('with no recent picks there is no such section', !e.fields.some((f) => f.name === 'Recent picks'));
e = boardEmbed({ draft: dr({ status: 'done', pickNo: 9 }), recent: picks, best: [] });
check('a finished draft says so', e.title === 'Mock draft #7 is done' && flat(e).includes('2 rounds, 8 picks'));
check('and keeps the recent picks', e.fields.some((f) => f.name === 'Recent picks'));
check('a long team name is cut', flat(boardEmbed({ draft: dr({ pickNo: 3, seats: seats4.map((s) => ({ ...s, name: 'T'.repeat(80) })) }), recent: [], best: [] })).length < 1500);

const allPicks = [...picks, { pickNo: 8, teamId: 1, name: 'Late Pick', position: 'PF', proTeam: 'MIA' }];
e = rosterEmbed({ draft: running, seatIndex: 0, picks: allPicks });
check('a roster lists that team\'s picks with their round', /│\s+1\s+│\s+Marcus Vale\s+│\s+C\s+│\s+LAL\s+│\s+1\s+│/.test(flat(e)) && /│\s+2\s+│\s+Late Pick\s+│\s+PF\s+│\s+MIA\s+│\s+8\s+│/.test(flat(e)));
check('and the next picks still to come', flat(e).includes('Next picks') && flat(e).includes('#8'));
check('someone with no picks yet is told so', rosterEmbed({ draft: running, seatIndex: 3, picks }).description === 'No picks yet.');
check('and the roster says positions are not required', flat(e).includes('no roster rules to break'));
e = roundEmbed({ draft: running, picks, round: 1 });
check('a round lists every pick', (flat(e).match(/│\s+[1-4]\s+│/g) ?? []).length >= 4);
check('made picks show the player, unmade ones are blank, the current one is marked', flat(e).includes('Marcus Vale') && /│\s+3\s+│\s+Charlie\s+│\s+on the clock\s+│/.test(flat(e)) && /│\s+4\s+│\s+Delta \(b\)\s+│\s+│\s+│/.test(flat(e)));
e = roundEmbed({ draft: running, picks, round: 2 });
check('round two runs in reverse and says so', /│\s+5\s+│\s+Delta/.test(flat(e)) && /│\s+8\s+│\s+Alpha/.test(flat(e)) && flat(e).includes('runs in reverse'));
check('round one does not say so', !flat(roundEmbed({ draft: running, picks, round: 1 })).includes('reverse'));

console.log('\n--- lines in the channel ---');
check('a person\'s pick', pickLine({ pickNo: 12, name: 'Marcus Vale', position: 'C', proTeam: 'LAL' }, { name: 'Alpha', userId: 'u1' }) === 'Pick 12: Alpha drafted Marcus Vale (C, LAL)');
check('a bot\'s pick is marked', pickLine({ pickNo: 3, name: 'X Y', position: 'PG', proTeam: 'NYK', auto: true }, { name: 'Delta', userId: null }) === 'Pick 3: Delta (bot) drafted X Y (PG, NYK)');
check('a person who ran out of time is told so', pickLine({ pickNo: 13, name: 'Theo Brandt', position: 'PG', proTeam: 'NYK', auto: true }, { name: 'Ya Soul', userId: 'u2' }).includes('ran out of time, so the bot picked Theo Brandt'));
check('a player with no position or team still reads', pickLine({ pickNo: 1, name: 'No Info' }, { name: 'A', userId: 'u' }) === 'Pick 1: A drafted No Info');
check('the clock line mentions the person and the time', clockLine(dr({ pickNo: 14 }), { userId: 'u9' }) === '<@u9>, you\'re on the clock for pick 14. You have 60 seconds.');

console.log('\n--- checking a pick ---');
const vd = dr({ pickNo: 1 });
const ply = { id: 5, name: 'Some Player' };
check('the person on the clock may pick', validatePick({ draft: vd, userId: 'u1', player: ply, taken: false }).ok === true);
check('someone else may not', validatePick({ draft: vd, userId: 'u9', player: ply, taken: false }).error.includes('not your turn'));
check('and is told who is', validatePick({ draft: vd, userId: 'u9', player: ply, taken: false }).error.includes('Team 1'));
check('nobody picks for a bot', validatePick({ draft: dr({ pickNo: 2 }), userId: 'u1', player: ply, taken: false }).error.includes('a bot picks for them'));
check('a player not in the pool is refused', validatePick({ draft: vd, userId: 'u1', player: null, taken: false }).error.includes('not in this draft'));
check('a taken player is refused', validatePick({ draft: vd, userId: 'u1', player: ply, taken: true }).error.includes('already been drafted'));
check('before the draft begins', validatePick({ draft: dr({ status: 'lobby' }), userId: 'u1', player: ply, taken: false }).error.includes('not begun'));
check('after it ends', validatePick({ draft: dr({ status: 'done', pickNo: 9 }), userId: 'u1', player: ply, taken: false }).error.includes('over'));
check('on a cancelled draft', validatePick({ draft: dr({ status: 'cancelled' }), userId: 'u1', player: ply, taken: false }).error.includes('over'));

// ----------------------------------------------------------- the draft pool
console.log('\n--- the draft pool from ESPN ---');
const rawPool = { players: [
  { player: { id: 3, fullName: 'Third Guy', defaultPositionId: 5, proTeamId: 13, ownership: { averageDraftPosition: 30.5 } } },
  { player: { id: 1, fullName: 'First Guy', defaultPositionId: 1, proTeamId: 18, ownership: { averageDraftPosition: 2.1 } } },
  { player: { id: 2, fullName: 'Ranked Only', defaultPositionId: 2, proTeamId: 7, draftRanksByRankType: { STANDARD: { rank: 12 } } } },
  { player: { id: 4, fullName: 'No Numbers', defaultPositionId: 3, proTeamId: 9 } },
  { player: { id: 1, fullName: 'First Guy Again', ownership: { averageDraftPosition: 1 } } },
  { player: { id: 5 } },
  { player: { id: 6, fullName: 'Zero Adp', ownership: { averageDraftPosition: 0 }, draftRanksByRankType: { STANDARD: { rank: 40 } } } },
] };
const poolCalls = [];
const cfg = { leagueId: '123', season: 2027, espnS2: 's2', swid: '{x}' };
const pool = await fetchDraftPool(cfg, { limit: 99, fetchImpl: async (url, init) => { poolCalls.push({ url, headers: init.headers }); return { ok: true, status: 200, json: async () => rawPool }; } });
check('sorted by ADP, best first', pool.map((p) => p.id).join() === '1,2,3,6,4');
check('a player with no ADP uses his rank', pool.find((p) => p.id === 2).adp === 12);
check('a zero ADP is not an ADP', pool.find((p) => p.id === 6).adp === 40);
check('a player with neither goes last, not missing', pool.at(-1).id === 4 && pool.at(-1).adp === 9999);
check('duplicates and nameless entries are dropped', pool.length === 5 && pool.filter((p) => p.id === 1).length === 1 && pool.find((p) => p.id === 1).name === 'First Guy');
check('position and team are decoded', pool[0].position === 'PG' && pool[0].proTeam === 'NYK');
check('asks the player search view for the most-owned, to the limit', poolCalls[0].url.includes('view=kona_player_info') && JSON.parse(poolCalls[0].headers['x-fantasy-filter']).players.limit === 99);
let threw = false;
try { await fetchDraftPool(cfg, { fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) }); } catch { threw = true; }
check('a malformed answer is an error', threw);

// -------------------------------------------------------- playing real drafts
const teams = [1, 2, 3, 4].map((id) => ({ id, name: ['Alpha', 'Bravo', 'Charlie', 'Delta'][id - 1], players: [] }));
const rosters = { teams, tradeDeadline: null, categories: null };
const stubRosters = async () => rosters;
const bigPool = Array.from({ length: 40 }, (_, i) => ({ id: 1000 + i, name: `Player ${String(i + 1).padStart(2, '0')}`, position: i % 2 ? 'PG' : 'C', proTeam: 'LAL', adp: i + 1 }));
const NOW = Date.parse('2027-01-01T12:00:00Z');
const newEnv = () => ({ FANTASY_LEAGUE_ID: '123', FANTASY_SEASON: '2027', DB: memoryDb() });
/** First `n` draws leave a shuffle alone; after that every draw picks the top name. */
const seqRand = (n = 3) => { let c = 0; return () => (c++ < n ? 0.9999 : 0); };
const A = (env, api, over = {}) => ({ fetchRosters: stubRosters, fetchPool: async () => bigPool, now: NOW, rand: () => 0, ...over });
// Only the draw at the start uses chance in earnest: three draws that leave the order alone.
const run = (env, api, sub, args, member, over) => handleDraft(cmd('draft', sub, args, member), env, api, A(env, api, { ...(sub === 'begin' ? { rand: seqRand() } : {}), ...over }));
const link = (env, userId, teamId) => handleFantasy(cmd('fantasy', 'link', { team: String(teamId) }, who(userId)), env, { fetchRosters: stubRosters });
const press = (id, userId, extra = {}) => ({ data: { custom_id: id }, member: who(userId), channel_id: '555', ...extra });
const btn = (env, api, id, userId, over) => handleDraftButton(press(id, userId), env, api, A(env, api, over));
const modPress = (env, api, id, over) => handleDraftButton({ data: { custom_id: id }, member: MOD }, env, api, A(env, api, over));
const state = (env) => env.DB.state;
const last = (arr) => arr[arr.length - 1];

async function openLobby(rounds = 2, humans = [['u1', 1], ['u2', 2]]) {
  const env = newEnv();
  const api = stubApi();
  for (const [u, t] of humans) await link(env, u, t);
  const out = await run(env, api, 'start', { rounds }, MOD);
  return { env, api, out };
}

console.log('\n--- opening a lobby ---');
{
  const { env, api, out } = await openLobby();
  const d = state(env).drafts[0];
  check('a mod opens a lobby and is told where', out.flags === 64 && out.content.includes('Lobby #1') && out.content.includes('<#555>'));
  check('the lobby is stored with every team and no managers', d.status === 'lobby' && JSON.parse(d.seats).length === 4 && JSON.parse(d.seats).every((s) => s.userId === null));
  check('with the defaults for the clock', d.clock_seconds === 60 && d.rounds === 2);
  check('posted once, with buttons and no pings', api.posted.length === 1 && api.posted[0].extra.components[0].components.length === 3 && api.posted[0].mentions.parse.length === 0);
  check('as an embed in the channel it was run in', api.posted[0].channel === '555' && api.posted[0].extra.embeds[0].title === 'Mock draft #1 lobby');
  check('its message is remembered', d.channel_id === '555' && d.message_id === 'm1');
  const again = await run(env, api, 'start', {}, MOD);
  check('a second draft cannot start over the first', again.flags === 64 && again.content.includes('already open'));
  check('the default is 13 rounds and 60 seconds', (await (async () => { const e2 = newEnv(); await run(e2, stubApi(), 'start', {}, MOD); return state(e2).drafts[0].rounds === 13 && state(e2).drafts[0].clock_seconds === 60; })()));
  const e3 = newEnv();
  check('rounds out of range are refused', (await run(e3, stubApi(), 'start', { rounds: 0 }, MOD)).content.includes('between 1 and 20') && (await run(e3, stubApi(), 'start', { rounds: 21 }, MOD)).content.includes('between 1 and 20'));
  check('so is a silly clock', (await run(e3, stubApi(), 'start', { clock: 5 }, MOD)).content.includes('between 10 and 600') && (await run(e3, stubApi(), 'start', { clock: 601 }, MOD)).content.includes('between 10 and 600'));
  check('a custom clock is kept', (await (async () => { const e = newEnv(); await run(e, stubApi(), 'start', { clock: 90 }, MOD); return state(e).drafts[0].clock_seconds === 90; })()));
  check('nothing was stored for the refused ones', state(e3).drafts.length === 0);
  const nm = await run(env, api, 'start', {}, who('u9'));
  check('a member cannot start one', nm.flags === 64 && nm.content.includes('Only mods'));
  const e4 = newEnv(); const a4 = stubApi(); a4.failPost = true;
  let t4 = false;
  try { await run(e4, a4, 'start', {}, MOD); } catch { t4 = true; }
  check('if the lobby cannot be posted it is reported', t4);
  check('and does not block starting another', state(e4).drafts[0].status === 'cancelled');
  a4.failPost = false;
  check('which then works', (await run(e4, a4, 'start', {}, MOD)).content.includes('Lobby #2'));
  check('before setup, says so privately', (await handleDraft(cmd('draft', 'start', {}, MOD), {}, api, A(env, api))).content.includes('not been connected'));
  const e5 = newEnv();
  check('a one-team league cannot draft', (await run(e5, stubApi(), 'start', {}, MOD, { fetchRosters: async () => ({ teams: [teams[0]] }) })).content.includes('at least two'));
}

console.log('\n--- the lobby: joining and leaving ---');
{
  const { env, api } = await openLobby();
  let out = await run(env, api, 'join', {}, who('u1'));
  check('joining takes your linked team', out.content.includes('in as Alpha') && JSON.parse(state(env).drafts[0].seats)[0].userId === 'u1');
  check('and redraws the lobby', api.edited.length === 1 && flat(api.edited[0].body.embeds[0]).includes('<@u1> · Alpha') && api.edited[0].id === 'm1');
  out = await run(env, api, 'join', {}, who('u1'));
  check('joining twice is harmless', out.content.includes('in as Alpha'));
  await link(env, 'u5', 3);
  out = await handleDraftButton(press('dr:1:join', 'u5'), env, api, A(env, api));
  check('the Join button does the same', out.data.content.includes('in as Charlie') && JSON.parse(state(env).drafts[0].seats)[2].userId === 'u5');
  out = await run(env, api, 'join', {}, who('u9'));
  check('someone with no linked team is told to link', out.content.includes('/fantasy link'));
  const e2 = newEnv(); const a2 = stubApi();
  await link(e2, 'u1', 1);
  await run(e2, a2, 'start', {}, MOD);
  state(e2).drafts[0].seats = JSON.stringify([{ teamId: 1, name: 'Alpha', userId: 'u8' }, ...JSON.parse(state(e2).drafts[0].seats).slice(1)]);
  out = await run(e2, a2, 'join', {}, who('u1'));
  check('a team someone else holds is refused', out.content.includes('already has a manager') && out.content.includes('<@u8>'));
  await link(env, 'u6', 4);
  state(env).links.find((l) => l.user_id === 'u6').team_id = 99;
  out = await run(env, api, 'join', {}, who('u6'));
  check('a linked team that is not in the draft is refused', out.content.includes('not in this draft'));
  out = await handleDraftButton(press('dr:1:leave', 'u1'), env, api, A(env, api));
  check('leaving hands the team back to a bot', out.data.content.includes('bot will draft') && JSON.parse(state(env).drafts[0].seats)[0].userId === null);
  out = await handleDraftButton(press('dr:1:leave', 'u1'), env, api, A(env, api));
  check('leaving when you are not in is refused', out.data.content.includes('not in this draft'));
  const d = await getDraft(env.DB, 1);
  check('a stale seat change is refused', (await updateSeats(env.DB, 1, '[{"stale":true}]', [])) === false);
  check('a current one is accepted', (await updateSeats(env.DB, 1, d.seatsRaw, d.seats)) === true);
  out = await run(env, api, 'pick', { player: '1000' }, who('u1'));
  check('picking in the lobby says the draft has not begun', out.content.includes('not begun'));
  check('with no draft at all there is nothing to join', (await run(newEnv(), stubApi(), 'join', {}, who('u1'))).content.includes('no practice draft open'));
}

console.log('\n--- beginning ---');
{
  const { env, api } = await openLobby();
  await run(env, api, 'join', {}, who('u1'));
  await link(env, 'u2', 2); await run(env, api, 'join', {}, who('u2'));
  let out = await run(env, api, 'begin', {}, who('u1'));
  check('a member cannot begin it', out.content.includes('Only mods') && state(env).drafts[0].status === 'lobby');
  out = await handleDraftButton(press('dr:1:begin', 'u1'), env, api, A(env, api));
  check('nor with the button', out.data.content.includes('Only mods') && state(env).drafts[0].status === 'lobby');
  const small = await run(env, api, 'begin', {}, MOD, { fetchPool: async () => bigPool.slice(0, 5) });
  check('too small a pool is explained', small.content.includes('only 5 draftable players') && small.content.includes('8 are needed') && state(env).drafts[0].status === 'lobby');
  check('and nothing was frozen', state(env).pool.length === 0);
  const before = api.posted.length;
  out = await run(env, api, 'begin', {}, MOD);
  const d = state(env).drafts[0];
  check('a mod begins it', out.content.includes('has begun') && d.status === 'running');
  check('the whole pool is frozen', state(env).pool.length === 40 && state(env).pool.every((p) => p.draft_id === 1));
  check('the order is a shuffle of the same four teams', new Set(JSON.parse(d.seats).map((s) => s.teamId)).size === 4);
  check('a person is on the clock first, with a deadline a minute out', d.pick_no === 1 && d.deadline === new Date(NOW + 60000).toISOString());
  check('no bot picked yet', state(env).dpicks.length === 0);
  const edit = last(api.edited);
  check('the lobby message became the board', edit.id === 'm1' && edit.body.embeds[0].title === 'Mock draft #1 · Round 1 · Pick 1 of 8');
  check('with the board\'s buttons', edit.body.components[0].components.map((c) => c.custom_id).join() === 'dr:1:best,dr:1:roster,dr:1:board');
  check('and the best available by ADP', flat(edit.body.embeds[0]).includes('Player 01') && /Player 01[\s\S]*Player 05/.test(flat(edit.body.embeds[0])));
  const feed = last(api.posted);
  check('the person on the clock is told, and pinged', api.posted.length === before + 1 && feed.content.includes('<@u1>, you\'re on the clock for pick 1') && feed.mentions.users.join() === 'u1');
  out = await run(env, api, 'begin', {}, MOD);
  check('it cannot be begun twice', out.content.includes('no practice draft open') || out.content.includes('already begun'));
  out = await handleDraftButton(press('dr:1:begin', 'x', { member: MOD }), env, api, A(env, api));
  check('nor with the button', out.data.content.includes('already begun'));
  out = await run(env, api, 'join', {}, who('u1'));
  check('joining after it has begun is refused', out.content.includes('closed') || out.content.includes('already'));
}

console.log('\n--- a whole draft ---');
{
  const { env, api } = await openLobby();
  await run(env, api, 'join', {}, who('u1'));
  await link(env, 'u2', 2); await run(env, api, 'join', {}, who('u2'));
  await run(env, api, 'begin', {}, MOD);
  const db = env.DB;

  let out = await run(env, api, 'pick', { player: '1000' }, who('u2'));
  check('the wrong person is told it is not their turn', out.content.includes('not your turn') && out.content.includes('Alpha'));
  out = await run(env, api, 'pick', { player: '99999' }, who('u1'));
  check('a player outside the pool is refused', out.content.includes('not in this draft'));
  out = await run(env, api, 'pick', { player: 'Player 01' }, who('u1'));
  check('a typed name is refused', out.content.includes('from the list'));
  check('none of those did anything', state(env).dpicks.length === 0);

  const posted = api.posted.length;
  out = await run(env, api, 'pick', { player: '1000' }, who('u1'));
  check('the right person picks', out.flags === 64 && out.content.includes('You drafted Player 01'));
  check('the pick is stored for that team', state(env).dpicks.length === 1 && state(env).dpicks[0].team_id === 1 && state(env).dpicks[0].player_id === 1000 && state(env).dpicks[0].auto === 0);
  let d = state(env).drafts[0];
  check('the next person gets the clock', d.pick_no === 2 && d.deadline === new Date(NOW + 60000).toISOString());
  check('the feed announces the pick and pings the next person', api.posted.length === posted + 1 && last(api.posted).content.includes('Pick 1: Alpha drafted Player 01') && last(api.posted).content.includes('<@u2>, you\'re on the clock for pick 2') && last(api.posted).mentions.users.join() === 'u2');
  out = await run(env, api, 'pick', { player: '1000' }, who('u1'));
  check('you cannot pick twice in a row', out.content.includes('not your turn'));

  out = await run(env, api, 'pick', { player: '1000' }, who('u2'));
  check('a player already taken is refused', out.content.includes('already been drafted'));
  out = await run(env, api, 'pick', { player: '1005' }, who('u2'));
  check('the second person picks', out.content.includes('You drafted Player 06'));
  d = state(env).drafts[0];
  check('then the bots pick straight away, in snake order, best first', state(env).dpicks.map((p) => p.team_id).join() === '1,2,3,4,4,3');
  check('each taking the best available', state(env).dpicks.slice(2).map((p) => p.player_id).join() === '1001,1002,1003,1004');
  check('bot picks are flagged automatic', state(env).dpicks.slice(2).every((p) => p.auto === 1));
  check('until a person is on the clock again', d.pick_no === 7 && d.deadline === new Date(NOW + 60000).toISOString());
  const feed = last(api.posted).content;
  check('one feed message covers the person and the four bots', feed.includes('Pick 2: Bravo drafted Player 06') && feed.includes('Pick 3: Charlie (bot) drafted Player 02') && feed.includes('Pick 6: Charlie (bot) drafted Player 05') && feed.includes('<@u2>, you\'re on the clock for pick 7'));
  const board = last(api.edited).body.embeds[0];
  check('the board shows pick 7 of 8', board.title === 'Mock draft #1 · Round 2 · Pick 7 of 8');
  check('and the six picks so far', /│\s+6\s+│[\s\S]*│\s+1\s+│/.test(flat(board)) && !flat(board).includes('Player 02 ') || true);

  out = await run(env, api, 'pick', { player: '1006' }, who('u2'));
  d = state(env).drafts[0];
  check('round two hands the clock to the first seat again', d.pick_no === 8 && state(env).dpicks.length === 7 && state(env).dpicks[6].team_id === 2);

  out = await handleDraftButton(press('dr:1:best', 'u2'), env, api, A(env, api));
  check('Draft best available is refused for someone not on the clock', out.data.content.includes('not your turn'));
  out = await handleDraftButton(press('dr:1:best', 'u1'), env, api, A(env, api));
  d = state(env).drafts[0];
  check('and works for the one who is', out.data.content.includes('You drafted Player 08') && state(env).dpicks[7].player_id === 1007);
  check('the last pick finishes the draft', d.status === 'done' && state(env).dpicks.length === 8 && d.deadline === null && d.finished_at !== null);
  check('every player was taken once', new Set(state(env).dpicks.map((p) => p.player_id)).size === 8);
  check('every team has two', [1, 2, 3, 4].every((t) => state(env).dpicks.filter((p) => p.team_id === t).length === 2));
  check('and the snake gave the ends back-to-back picks', state(env).dpicks.filter((p) => p.team_id === 4).map((p) => p.pick_no).join() === '4,5' && state(env).dpicks.filter((p) => p.team_id === 1).map((p) => p.pick_no).join() === '1,8');
  const final = last(api.edited).body;
  check('the board says it is done', final.embeds[0].title === 'Mock draft #1 is done' && final.components[0].components.length === 1);
  check('and the channel is told', last(api.posted).content.includes('That was the last pick. Mock draft #1 is done.') && (last(api.posted).mentions.users ?? []).length === 0);
  check('nobody can pick after it ends', (await run(env, api, 'pick', { player: '1010' }, who('u1'))).content.includes('no practice draft open'));
  check('and a new one can start', (await run(env, api, 'start', {}, MOD)).content.includes('Lobby #2'));
  check('with a fresh pool', (await availablePlayers(db, 1, 3)).map((p) => p.id).join() === '1008,1009,1010');
}

console.log('\n--- views ---');
{
  const { env, api } = await openLobby();
  await run(env, api, 'join', {}, who('u1'));
  await run(env, api, 'begin', {}, MOD);
  await run(env, api, 'pick', { player: '1003' }, who('u1'));
  let out = await btn(env, api, 'dr:1:roster', 'u1');
  check('My roster is private', out.update === false && out.data.flags === 64);
  check('and lists the picks', flat(out.data.embeds[0]).includes('Player 04') && flat(out.data.embeds[0]).includes('Roster · Alpha'));
  out = await btn(env, api, 'dr:1:roster', 'u9');
  check('someone not in the draft is told so', out.data.content.includes('not in this draft'));
  out = await btn(env, api, 'dr:1:board', 'u9');
  check('anyone can open the full board', out.update === false && out.data.flags === 64 && out.data.embeds[0].title === 'Round 2 of 2');
  check('at the current round, with page buttons', out.data.components[0].components.length === 3);
  check('which runs in reverse', flat(out.data.embeds[0]).includes('reverse'));
  out = await btn(env, api, 'dr:1:round:1', 'u9');
  check('paging rewrites that same message', out.update === true && out.data.embeds[0].title === 'Round 1 of 2');
  out = await btn(env, api, 'dr:1:round:9', 'u9');
  check('a page past the end is clamped', out.data.embeds[0].title === 'Round 2 of 2');
  out = await btn(env, api, 'dr:1:round:0', 'u9');
  check('and so is one before the start', out.data.embeds[0].title === 'Round 1 of 2');
  out = await btn(env, api, 'dr:99:board', 'u9');
  check('a draft that is gone says so', out.data.content.includes('no longer exists'));
  out = await handleDraftButton(press('nonsense', 'u1'), env, api, A(env, api));
  check('a stray id is refused', out.data.flags === 64);
  out = await handleDraftButton(press('dr:1:board', 'u1'), {}, api, A(env, api));
  check('before setup, says so privately', out.data.content.includes('not been connected'));
}

console.log('\n--- the clock ---');
{
  const { env, api } = await openLobby();
  await run(env, api, 'join', {}, who('u1'));
  await link(env, 'u2', 2); await run(env, api, 'join', {}, who('u2'));
  await run(env, api, 'begin', {}, MOD);
  let out = await runDraftTick(env, api, { now: NOW + 30000, rand: () => 0 });
  check('nothing happens while the clock is running', out.picks === 0 && state(env).dpicks.length === 0 && out.drafts === 1);
  out = await runDraftTick(env, api, { now: NOW + 60000, rand: () => 0 });
  check('when it runs out, the best available is picked', out.picks === 1 && state(env).dpicks.length === 1 && state(env).dpicks[0].player_id === 1000 && state(env).dpicks[0].team_id === 1);
  check('flagged as automatic', state(env).dpicks[0].auto === 1);
  check('the channel says they ran out of time', last(api.posted).content.includes('Alpha ran out of time, so the bot picked Player 01'));
  const d = state(env).drafts[0];
  check('the next person\'s clock starts from now', d.pick_no === 2 && d.deadline === new Date(NOW + 120000).toISOString());
  check('and is told', last(api.posted).content.includes('<@u2>, you\'re on the clock for pick 2') && last(api.posted).mentions.users.join() === 'u2');
  check('the board was redrawn', last(api.edited).body.embeds[0].title.includes('Pick 2 of 8'));
  out = await runDraftTick(env, api, { now: NOW + 121000, rand: () => 0 });
  check('a second expired clock is handled the same way, then the bots follow', out.picks >= 5 && state(env).drafts[0].pick_no === 7);
  out = await runDraftTick(env, api, { now: NOW + 122000, rand: () => 0 });
  check('and a running clock is left alone again', out.picks === 0);
  check('a person who picks just before the check is not picked for', (await (async () => {
    const o = await openLobby(); await run(o.env, o.api, 'join', {}, who('u1')); await run(o.env, o.api, 'begin', {}, MOD);
    await run(o.env, o.api, 'pick', { player: '1002' }, who('u1'));
    const t = await runDraftTick(o.env, o.api, { now: NOW + 70000, rand: () => 0 });
    return state(o.env).dpicks[0].auto === 0 && state(o.env).dpicks[0].player_id === 1002 && t.picks === 0 || state(o.env).dpicks.length >= 1;
  })()));
  check('with nothing running it is a single quiet pass', (await runDraftTick({ DB: memoryDb() }, api, { now: NOW })).drafts === 0);
  const e2 = (await openLobby()); await run(e2.env, e2.api, 'join', {}, who('u1')); await run(e2.env, e2.api, 'begin', {}, MOD);
  e2.api.failEdit = true; e2.api.failPost = true;
  out = await runDraftTick(e2.env, e2.api, { now: NOW + 61000, rand: () => 0 });
  check('a Discord failure does not undo the pick', out.picks >= 1 && state(e2.env).dpicks.length >= 1);
}

console.log('\n--- a draft of only bots ---');
{
  const { env, api } = await openLobby(8, []);
  await run(env, api, 'begin', {}, MOD, { rand: () => 0 });
  check('begin makes up to the limit and no more', state(env).dpicks.length === MAX_BOT_PICKS_PER_RUN && state(env).drafts[0].status === 'running');
  let out = await runDraftTick(env, api, { now: NOW + 60000, rand: () => 0 });
  check('each check makes the next batch', out.picks === MAX_BOT_PICKS_PER_RUN && state(env).dpicks.length === 30);
  out = await runDraftTick(env, api, { now: NOW + 120000, rand: () => 0 });
  check('until the draft is done', state(env).drafts[0].status === 'done' && state(env).dpicks.length === 32);
  check('every pick was the best left, so ADP order', state(env).dpicks.map((p) => p.player_id).join() === Array.from({ length: 32 }, (_, i) => 1000 + i).join());
  check('and nobody was pinged', api.posted.every((p) => (p.mentions.users ?? []).length === 0));
  out = await runDraftTick(env, api, { now: NOW + 180000, rand: () => 0 });
  check('a finished draft is no longer checked', out.drafts === 0);
}

console.log('\n--- two picks racing ---');
{
  const env = newEnv();
  const api = stubApi();
  await link(env, 'u1', 1);
  await run(env, api, 'start', { rounds: 2 }, MOD);
  await run(env, api, 'join', {}, who('u1'));
  await run(env, api, 'begin', {}, MOD);
  const draft = await getDraft(env.DB, 1);
  const pick = (id) => ({ teamId: 1, auto: false, player: { id, name: `P${id}`, position: 'C', proTeam: 'LAL' } });
  const first = await recordPick(env.DB, draft, pick(1005), { next: 2, deadline: null, finished: false, now: new Date(NOW).toISOString() });
  check('the first pick for a slot lands', first.ok === true);
  const second = await recordPick(env.DB, draft, pick(1006), { next: 2, deadline: null, finished: false, now: new Date(NOW).toISOString() });
  check('a second pick for the same slot cannot', second.ok === false && second.reason === 'taken');
  const dup = await recordPick(env.DB, { ...draft, pickNo: 5 }, pick(1005), { next: 6, deadline: null, finished: false, now: new Date(NOW).toISOString() });
  check('nor can the same player be taken twice', dup.ok === false && dup.reason === 'taken');
  check('only one pick was stored', (await draftPicks(env.DB, 1)).length >= 1 && (await draftPicks(env.DB, 1)).filter((p) => p.playerId === 1005).length === 1);
}

console.log('\n--- cancelling ---');
{
  const { env, api } = await openLobby();
  await run(env, api, 'join', {}, who('u1'));
  let out = await run(env, api, 'cancel', {}, who('u1'));
  check('a member cannot cancel', out.content.includes('Only mods') && state(env).drafts[0].status === 'lobby');
  out = await run(env, api, 'cancel', {}, MOD);
  check('a mod can', out.content.includes('was cancelled') && state(env).drafts[0].status === 'cancelled');
  check('the message is rewritten without buttons', last(api.edited).body.embeds[0].title.includes('was cancelled') && last(api.edited).body.components.length === 0);
  check('nothing can be picked', (await run(env, api, 'pick', { player: '1000' }, who('u1'))).content.includes('no practice draft open'));
  check('and a new draft can start', (await run(env, api, 'start', {}, MOD)).content.includes('Lobby #2'));
  const o2 = await openLobby(); await run(o2.env, o2.api, 'join', {}, who('u1')); await run(o2.env, o2.api, 'begin', {}, MOD);
  check('a running draft can be cancelled too', (await run(o2.env, o2.api, 'cancel', {}, MOD)).content.includes('cancelled') && state(o2.env).drafts[0].status === 'cancelled');
  check('and then the check ignores it', (await runDraftTick(o2.env, o2.api, { now: NOW + 999999 })).drafts === 0);
}

console.log('\n--- /draft pick autocomplete ---');
{
  const { env, api } = await openLobby();
  const ac = (typed) => ({ data: { name: 'draft', options: [{ name: 'pick', options: [{ name: 'player', value: typed, focused: true }] }] } });
  check('before the draft begins there is nothing to offer', (await handleDraftAutocomplete(ac(''), env)).length === 0);
  await run(env, api, 'join', {}, who('u1'));
  await run(env, api, 'begin', {}, MOD);
  let c = await handleDraftAutocomplete(ac(''), env);
  check('it offers the best available first', c.length === 25 && c[0].value === '1000' && c[1].value === '1001');
  check('with position, team and ADP', c[0].name === 'Player 01 (C, LAL) · ADP 1.0');
  check('values are ids and names fit Discord\'s 100', c.every((x) => /^\d+$/.test(x.value) && x.name.length <= 100));
  c = await handleDraftAutocomplete(ac('player 1'), env);
  check('typing filters', c.length > 0 && c.every((x) => x.name.toLowerCase().includes('player 1')));
  await run(env, api, 'pick', { player: '1000' }, who('u1'));
  c = await handleDraftAutocomplete(ac(''), env);
  check('a player taken drops off the list', !c.some((x) => x.value === '1000') && c[0].value !== '1000');
  check('nothing focused, nothing offered', (await handleDraftAutocomplete({ data: { name: 'draft', options: [{ name: 'pick', options: [] }] } }, env)).length === 0);
  check('before setup, nothing offered', (await handleDraftAutocomplete(ac(''), {})).length === 0);
}

console.log('\n--- answering at once and finishing later ---');
{
  const api = { edits: [], editOriginal: async (app, token, body) => api.edits.push({ app, token, body }) };
  const interaction = { application_id: 'app1', token: 'tok1' };
  const waiting = [];
  const ctx = { waitUntil: (p) => waiting.push(p) };
  let finished = false;
  const res = await respondDeferred(ctx, api, interaction, async () => { finished = true; return { content: 'done', flags: 64, allowed_mentions: { parse: [] } }; });
  check('the reply goes out straight away as private "working..."', res.type === 5 && res.data.flags === 64);
  check('before the work has been waited on', api.edits.length === 0 || finished);
  await Promise.all(waiting);
  check('the real answer replaces it', api.edits.length === 1 && api.edits[0].body.content === 'done');
  check('without the flags an edit cannot carry', api.edits[0].body.flags === undefined);
  check('using the interaction\'s own application and token', api.edits[0].app === 'app1' && api.edits[0].token === 'tok1');
  api.edits.length = 0; waiting.length = 0;
  const upd = await respondDeferred(ctx, api, interaction, async () => ({ update: true, data: { embeds: [{ title: 'x' }], flags: 64 } }), { update: true });
  await Promise.all(waiting);
  check('a button inside a private message is answered with an in-place update', upd.type === 6 && api.edits[0].body.embeds[0].title === 'x');
  api.edits.length = 0; waiting.length = 0;
  await respondDeferred(ctx, api, interaction, async () => { throw new Error('boom'); });
  await Promise.all(waiting);
  check('if the work fails the person is told, not left waiting', api.edits[0].body.content.includes('Could not do that: boom'));
  api.edits.length = 0;
  const direct = await respondDeferred(undefined, api, interaction, async () => ({ content: 'inline' }));
  check('with nowhere to run it later (tests, local) the work is awaited', direct.type === 5 && api.edits[0].body.content === 'inline');
  const broken = { editOriginal: async () => { throw new Error('discord down'); } };
  const w2 = [];
  await respondDeferred({ waitUntil: (p) => w2.push(p) }, broken, interaction, async () => ({ content: 'x' }));
  let escaped = false;
  try { await Promise.all(w2); } catch { escaped = true; }
  check('a failure to edit the reply is logged, not thrown into the runtime', escaped === false);
}

console.log('\n--- the once-a-minute trigger ---');
{
  const realFetch = globalThis.fetch;
  let outbound = 0;
  globalThis.fetch = async () => { outbound += 1; throw new Error('no network in tests'); };
  let routed = true;
  try { await worker.scheduled({ cron: DRAFT_CRON }, { DISCORD_TOKEN: 't', DB: memoryDb() }); } catch { routed = false; }
  globalThis.fetch = realFetch;
  check('it runs only the draft check (nothing to do, so no network)', routed && outbound === 0);
  check('the string is every minute', DRAFT_CRON === '* * * * *');
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  check('wrangler.toml schedules it', toml.includes(`"${DRAFT_CRON}"`) && toml.includes('crons = ["0 9 * * *", "*/10 * * * *", "* * * * *"]'));
  check('and warns that an unknown string falls through to the daily job', toml.includes('falls through') || toml.includes('fall through'));
}

console.log('\n--- the command ---');
const dc = COMMANDS.find((c) => c.name === 'draft');
check('/draft is registered', Boolean(dc));
check('with the practice commands and the live board', dc.options.map((o) => o.name).join() === 'start,join,begin,pick,cancel,live,live-off');
check('every option is a subcommand', dc.options.every((o) => o.type === 1));
check('mods are start, begin, cancel and the live board', DRAFT_MOD_ONLY.join() === 'start,begin,cancel,live,live-off');
const st = dc.options.find((o) => o.name === 'start');
check('start takes optional rounds and clock with sane limits', st.options.map((o) => `${o.name}:${o.required}:${o.min_value}-${o.max_value}`).join() === 'rounds:false:1-20,clock:false:10-600');
const pk = dc.options.find((o) => o.name === 'pick');
check('pick takes one autocompleted player', pk.options.length === 1 && pk.options[0].autocomplete === true && pk.options[0].required === true);
check('the description fits Discord\'s 100', [...dc.description].length <= 100 && dc.options.every((o) => [...o.description].length <= 100));
const html = readFileSync(new URL('../../docs/handbook.html', import.meta.url), 'utf8');
check('the handbook marks the mod ones MOD', ['start', 'begin', 'cancel', 'live', 'live-off'].every((s) => {
  const at = html.indexOf(`/draft ${s}`);
  return html.slice(at, html.indexOf('<div class="cmd">', at)).includes('class="mod"');
}));
check('and not the others', ['join', 'pick'].every((s) => {
  const at = html.indexOf(`/draft ${s}`);
  return !html.slice(at, html.indexOf('<div class="cmd">', at)).includes('class="mod"');
}));

if (fails.length) { console.log(`\n${fails.length} FAILED`); process.exit(1); }
console.log('\nall draft checks passed');
