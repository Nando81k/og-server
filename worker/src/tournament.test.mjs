import {
  PLACEMENT_POINTS, pointsFor, drawSeeds, replay, canReport, matchLabel,
  reportChoices, signupMessage, bracketMessage, resultsMessage, awardsFor,
  MIN_ENTRANTS, MAX_ENTRANTS,
} from './tournament.mjs';
import { createBracket, reportResult, openMatches, isComplete, placements } from './bracket.mjs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };

const names = (n) => Array.from({ length: n }, (_, i) => String.fromCharCode(97 + i));

/** Play a bracket out, recording results the way the database stores them. */
function playOut(seeds) {
  let bracket = createBracket(seeds);
  const results = [];
  for (let guard = 0; guard < 200 && !isComplete(bracket); guard += 1) {
    const open = openMatches(bracket);
    if (open.length === 0) break;
    for (const m of open) {
      const winner = m.a < m.b ? m.a : m.b;
      bracket = reportResult(bracket, m.id, winner);
      results.push({ match: m.id, winner });
    }
  }
  return { bracket, results };
}

console.log('--- what a placing is worth ---');
check('winning is worth the most', pointsFor(1).points === 50);
check('runner up', pointsFor(2).points === 30);
check('third', pointsFor(3).points === 20);
check('fourth', pointsFor(4).points === 12);
// The engine reports joint placings, so 5th exists and 6th does not. The table
// has to answer for a place it never literally lists.
check('a joint 5th falls in the top 8 band', pointsFor(5).points === 6);
check('7th is still top 8', pointsFor(7).points === 6);
check('9th drops to the entry points', pointsFor(9).points === 2);
check('a 32 player field still pays out at the bottom', pointsFor(32).points === 2);
check('every place has an answer',
  Array.from({ length: MAX_ENTRANTS }, (_, i) => pointsFor(i + 1)).every((r) => r.points > 0));
check('points never go up as you place worse', (() => {
  let last = Infinity;
  for (let p = 1; p <= MAX_ENTRANTS; p += 1) {
    const { points } = pointsFor(p);
    if (points > last) return false;
    last = points;
  }
  return true;
})());
check('every band has a label people can read',
  PLACEMENT_POINTS.every((r) => typeof r.label === 'string' && r.label.length > 0));

console.log('\n--- the draw ---');
check('everyone who entered is in the draw', drawSeeds(names(8)).length === 8);
check('nobody is dropped or duplicated',
  new Set(drawSeeds(names(12))).size === 12);
check('someone signed up twice only appears once',
  drawSeeds(['a', 'b', 'a', 'c']).length === 3);
// rand() === 0 makes Fisher-Yates swap every element with index 0 in turn,
// rotating the list. A specific checkable order beats "something shuffled".
check('the draw is driven by the rand it is given',
  drawSeeds(['a', 'b', 'c', 'd'], () => 0).join() === 'b,c,d,a');
check('a different rand gives a different draw',
  drawSeeds(names(8), () => 0).join() !== drawSeeds(names(8), () => 0.99).join());
check('a fixed rand gives the same draw twice',
  drawSeeds(names(10), () => 0.5).join() === drawSeeds(names(10), () => 0.5).join());
check('the draw does not edit the list it was given', (() => {
  const entered = names(6);
  drawSeeds(entered, () => 0);
  return entered.join() === 'a,b,c,d,e,f';
})());

console.log('\n--- replaying what is stored ---');
// The database stores the seed order and the results, never the bracket. If
// replay were not exact, every command would read a different tournament from
// the one the last command wrote.
for (const n of [3, 5, 8, 11, 16, 32]) {
  const seeds = names(n);
  const { bracket, results } = playOut(seeds);
  const rebuilt = replay(seeds, results);
  check(`${n} entrants: a replay matches the bracket it came from`,
    JSON.stringify(rebuilt) === JSON.stringify(bracket));
  check(`${n} entrants: the replayed bracket places everyone the same way`,
    JSON.stringify(placements(rebuilt)) === JSON.stringify(placements(bracket)));
}
check('no results yet replays to a fresh bracket',
  JSON.stringify(replay(names(8), [])) === JSON.stringify(createBracket(names(8))));
check('a missing results list is the same as an empty one',
  JSON.stringify(replay(names(8), undefined)) === JSON.stringify(createBracket(names(8))));

console.log('\n--- undo is just one fewer result ---');
// The reason results are stored instead of the bracket: undoing a report means
// replaying without it, not unpicking a cascade through the losers bracket.
{
  const seeds = names(8);
  const { results } = playOut(seeds);
  const undone = replay(seeds, results.slice(0, -1));
  const last = results[results.length - 1];
  check('the undone match has no result again',
    undone.matches.find((m) => m.id === last.match).winner === null);
  check('the undone bracket is no longer finished', !isComplete(undone));
  check('the undone match is playable again',
    openMatches(undone).some((m) => m.id === last.match));
  check('redoing it lands back where it was',
    JSON.stringify(replay(seeds, results)) === JSON.stringify(replay(seeds, [...results.slice(0, -1), last])));
}
check('undoing a mid-tournament result also undoes what it caused', (() => {
  const seeds = names(8);
  const { results } = playOut(seeds);
  // Drop the very first match reported. Everything downstream of it is gone.
  const rewound = replay(seeds, results.slice(0, 1));
  return openMatches(rewound).length > 0 && !isComplete(rewound);
})());

console.log('\n--- who may report ---');
{
  const m = { id: 'W1-1', a: 'nando', b: 'mike' };
  check('a player in the match may report it', canReport(m, 'nando'));
  check('the other player may too', canReport(m, 'mike'));
  check('a bystander may not', !canReport(m, 'someone-else'));
  check('a mod may report anyone’s match', canReport(m, 'someone-else', { isMod: true }));
}

console.log('\n--- naming a match ---');
{
  const m = { id: 'W2-1', a: '111', b: '222' };
  const who = { 111: 'Nando', 222: 'Mike' };
  check('a match reads as its two players', matchLabel(m, who) === 'W2-1 — Nando vs Mike');
  check('an unknown id does not render as undefined',
    matchLabel({ id: 'W1-1', a: '999', b: '111' }, who) === 'W1-1 — someone vs Nando');
}

console.log('\n--- autocomplete ---');
{
  const seeds = names(32);
  const bracket = createBracket(seeds);
  const who = Object.fromEntries(seeds.map((s) => [s, `Player ${s.toUpperCase()}`]));
  const all = reportChoices(bracket, who);
  check('only open matches are offered',
    all.every((c) => openMatches(bracket).some((m) => m.id === c.value)));
  check('Discord’s 25 choice limit is respected', all.length <= 25);
  // The largest bracket allowed opens 16 matches at once and never more, at
  // any point in any size — so the 25 cap above is a guard that should never
  // actually fire. Worth pinning: if a future format did exceed it, the
  // truncation would silently hide matches from the people in them.
  check('the biggest possible round still fits without truncating',
    openMatches(bracket).length === 16 && all.length === 16);
  check('every choice name fits Discord’s 100 characters',
    all.every((c) => [...c.name].length <= 100));
  check('typing filters by player name',
    reportChoices(bracket, who, 'player a').every((c) => c.name.toLowerCase().includes('player a')));
  check('typing a match id filters too',
    reportChoices(bracket, who, 'W1-1').length >= 1);
  check('typing something nobody matches offers nothing',
    reportChoices(bracket, who, 'zzzzz').length === 0);
  check('the value is the match id, which is what the handler needs',
    all.every((c) => /^(W|L|GF)/.test(c.value)));
}

console.log('\n--- what the messages say ---');
const DISCORD_LIMIT = 2000;
{
  const entrants = names(MAX_ENTRANTS).map((u) => ({ userId: u }));
  const full = signupMessage({ name: 'Winter Brawl', entrants });
  check('a full sign-up list fits in a Discord message', [...full].length < DISCORD_LIMIT);
  check('the sign-up post names the tournament', full.includes('Winter Brawl'));
  check('a full list says it can be started', full.includes('/bracket start'));

  const empty = signupMessage({ name: 'Winter Brawl', entrants: [] });
  check('an empty sign-up says how to join', empty.includes('/bracket join'));
  check('an empty sign-up does not claim it can start', !empty.includes('/bracket start'));

  const nearly = signupMessage({ name: 'x', entrants: [{ userId: 'a' }] });
  check('one short of the minimum says how many more are needed',
    nearly.includes(`${MIN_ENTRANTS - 1} more needed`));
}
{
  const seeds = names(MAX_ENTRANTS);
  const fresh = createBracket(seeds);
  const msg = bracketMessage({ name: 'Winter Brawl', bracket: fresh });
  check('a 32 player opening round fits in a Discord message', [...msg].length < DISCORD_LIMIT);
  check('it says what to go and play', msg.includes('Play these now'));
  check('it says how many entrants there are', msg.includes('32 entrants'));
  check('everyone is still alive before anything is played', msg.includes('32 still alive'));
  check('it tells people to report', msg.includes('/bracket report'));

  const { bracket: done } = playOut(seeds);
  const endMsg = bracketMessage({ name: 'Winter Brawl', bracket: done });
  check('a finished bracket has nothing to play', endMsg.includes('Nothing playable'));
  check('a finished 32 player bracket leaves 2 alive', endMsg.includes('2 still alive'));
}
{
  const seeds = names(8);
  const { bracket } = playOut(seeds);
  const msg = resultsMessage({ name: 'Winter Brawl', bracket });
  check('the results fit in a Discord message', [...msg].length < DISCORD_LIMIT);
  check('everyone who entered is placed',
    seeds.every((s) => msg.includes(`<@${s}>`)));
  check('the winner is listed first', msg.indexOf('**1.**') < msg.indexOf('**2.**'));
  check('each placing shows what it earned', msg.includes('+50') && msg.includes('+30'));

  const big = resultsMessage({ name: 'Winter Brawl', bracket: playOut(names(MAX_ENTRANTS)).bracket });
  check('a 32 player result still fits', [...big].length < DISCORD_LIMIT);
}

console.log('\n--- feeding the season leaderboard ---');
for (const n of [3, 8, 16, 32]) {
  const { bracket } = playOut(names(n));
  const awards = awardsFor(bracket, 'Winter Brawl');
  check(`${n} entrants: everyone who entered is awarded something`, awards.length === n);
  check(`${n} entrants: nobody is awarded twice`,
    new Set(awards.map((a) => a.userId)).size === n);
  check(`${n} entrants: every award is positive`, awards.every((a) => a.amount > 0));
  check(`${n} entrants: the reason names the tournament and the placing`,
    awards.every((a) => a.reason.startsWith('Winter Brawl — ') && a.reason.length > 15));
  check(`${n} entrants: the winner gets the most`,
    Math.max(...awards.map((a) => a.amount)) === 50 &&
    awards.filter((a) => a.amount === 50).length === 1);
}
check('an unfinished bracket owes nobody anything',
  awardsFor(createBracket(names(8)), 'Winter Brawl').length === 0);
check('the reason fits the ledger’s 120 character limit',
  awardsFor(playOut(names(8)).bracket, 'A'.repeat(60)).every((a) => a.reason.length <= 120));

console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
