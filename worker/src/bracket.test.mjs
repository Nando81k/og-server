import {
  seedOrder, bracketSize, createBracket, reportResult, openMatches, isComplete, placements,
  MIN_ENTRANTS, MAX_ENTRANTS,
} from './bracket.mjs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };

const names = (n) => Array.from({ length: n }, (_, i) => String.fromCharCode(97 + i));

/** Play a whole bracket with the better seed always winning. */
function playOut(bracket, { upset = null } = {}) {
  let br = bracket;
  let played = 0;
  // A stall would otherwise spin forever, and a stall is exactly the bug this
  // is looking for: wiring that leaves a match nobody can ever play.
  for (let guard = 0; guard < 200 && !isComplete(br); guard += 1) {
    const open = openMatches(br);
    if (open.length === 0) return { br, played, stalled: true };
    for (const m of open) {
      const better = m.a < m.b ? m.a : m.b;
      const worse = better === m.a ? m.b : m.a;
      const winner = upset && upset(m) ? worse : better;
      br = reportResult(br, m.id, winner);
      played += 1;
    }
  }
  return { br, played, stalled: false };
}

console.log('--- seeding ---');
// The point of seed order: 1 and 2 cannot meet before the final.
check('a two-player order is trivial', seedOrder(2).join() === '1,2');
check('four seeds mirror', seedOrder(4).join() === '1,4,2,3');
check('eight seeds mirror again', seedOrder(8).join() === '1,8,4,5,2,7,3,6');
check('every seed appears exactly once',
  new Set(seedOrder(16)).size === 16);
check('seed 1 and seed 2 start in opposite halves', (() => {
  const o = seedOrder(16);
  return o.indexOf(1) < 8 && o.indexOf(2) >= 8;
})());

console.log('\n--- bracket size ---');
check('a power of two is itself', bracketSize(8) === 8);
check('five rounds up to eight', bracketSize(5) === 8);
check('three rounds up to four', bracketSize(3) === 4);
check('nine rounds up to sixteen', bracketSize(9) === 16);

console.log('\n--- structure ---');
const eight = createBracket(names(8));
check('eight players make a bracket of eight', eight.size === 8);
check('three winners rounds', eight.rounds === 3);
// 7 winners + 6 losers + grand final + its reset.
check('fifteen matches including the reset', eight.matches.length === 15);
check('round one seats the top seed against the bottom',
  eight.matches[0].a === 'a' && eight.matches[0].b === 'h');
check('the winners final feeds the grand final',
  eight.matches.find((m) => m.id === 'W3-1').next.match === 'GF');
check('the losers final feeds the grand final',
  eight.matches.find((m) => m.id === 'L4-1').next.match === 'GF');
check('the winners final loser drops to the losers final',
  eight.matches.find((m) => m.id === 'W3-1').drop.match === 'L4-1');
check('nobody drops out of the losers bracket',
  eight.matches.filter((m) => m.bracket === 'L').every((m) => m.drop === null));

console.log('\n--- every match is reachable ---');
// An unreachable match is a bracket that stalls forever. Every match except
// round one and the grand final must be pointed at by something.
const pointedAt = new Set();
for (const m of eight.matches) {
  if (m.next) pointedAt.add(m.next.match);
  if (m.drop) pointedAt.add(m.drop.match);
}
const orphans = eight.matches
  .filter((m) => !(m.bracket === 'W' && m.round === 1) && m.id !== 'GF2')
  .filter((m) => !pointedAt.has(m.id))
  .map((m) => m.id);
check(`no orphan match${orphans.length ? ` (${orphans})` : ''}`, orphans.length === 0);

const doubleFilled = [];
for (const slot of ['a', 'b']) {
  for (const m of eight.matches) {
    const feeders = eight.matches.filter(
      (x) => (x.next?.match === m.id && x.next.slot === slot) ||
             (x.drop?.match === m.id && x.drop.slot === slot)
    );
    if (feeders.length > 1) doubleFilled.push(`${m.id}.${slot}`);
  }
}
check(`no slot fed by two matches${doubleFilled.length ? ` (${doubleFilled})` : ''}`,
  doubleFilled.length === 0);

console.log('\n--- a bracket of every size plays to the end ---');
// The strongest check here. A losers-bracket wiring mistake usually shows up
// at one size and not another, so every size gets played out rather than
// trusting that eight working means sixteen does.
for (let n = MIN_ENTRANTS; n <= MAX_ENTRANTS; n += 1) {
  const { br, stalled } = playOut(createBracket(names(n)));
  const done = isComplete(br) && !stalled;
  const places = placements(br);
  const ranked = new Set(places.map((p) => p.userId));
  const everyone = ranked.size === n;
  check(`${String(n).padStart(2)} entrants: completes and places all ${n}`, done && everyone);
}

console.log('\n--- the better seed wins when nobody upsets ---');
for (const n of [4, 8, 16]) {
  const { br } = playOut(createBracket(names(n)));
  const p = placements(br);
  check(`${n} entrants: seed 1 wins`, p[0].userId === 'a' && p[0].place === 1);
  check(`${n} entrants: seed 2 is runner up`, p[1].userId === 'b' && p[1].place === 2);
}

console.log('\n--- byes ---');
const five = createBracket(names(5));
check('five players use a bracket of eight', five.size === 8);
const byes = five.matches.filter((m) => m.bye);
// Three empty seats in round one, plus one losers-bracket match whose two
// feeders were both byes. That fourth one is the cascade working: without it
// the match would sit forever waiting on an opponent who was never coming,
// which is exactly how every non-power-of-two bracket used to stall.
check('round one byes resolve at creation',
  byes.filter((m) => m.bracket === 'W').length === 3);
check('a losers match fed only by byes collapses too',
  byes.some((m) => m.bracket === 'L'));
check('a bye is never something to go and play',
  openMatches(five).every((m) => !m.bye));
check('the player with a bye is already through',
  byes.every((m) => m.winner === (m.a ?? m.b)));
check('a bye gives the top seed a free first round',
  five.matches.find((m) => m.id === 'W1-1').winner === 'a');

console.log('\n--- the grand final reset ---');
// The losers-bracket player has to win twice, because they have already lost
// once and the winners-bracket player has not.
const upsetRun = playOut(createBracket(names(4)), { upset: (m) => m.id === 'GF' });
check('winning the grand final from losers forces a reset',
  upsetRun.br.matches.find((m) => m.id === 'GF2').a !== null);
check('the bracket is not finished until the reset is played',
  isComplete(upsetRun.br));
const noReset = playOut(createBracket(names(4)));
check('no reset when the winners player takes it',
  noReset.br.matches.find((m) => m.id === 'GF2').winner === null);
check('the unplayed reset is never offered as an open match',
  openMatches(noReset.br).length === 0);

console.log('\n--- placements ---');
const p8 = placements(playOut(createBracket(names(8))).br);
check('joint placings share a number', p8.filter((x) => x.place === 5).length === 2);
check('a shared 5th is followed by 7th, not 6th',
  p8.some((x) => x.place === 7) && !p8.some((x) => x.place === 6));
check('placings never repeat a winner',
  new Set(p8.map((x) => x.userId)).size === p8.length);
check('an unfinished bracket has no placings',
  placements(createBracket(names(8))).length === 0);

console.log('\n--- refusing what it should ---');
const bad = (fn) => { try { fn(); return false; } catch { return true; } };
check('two entrants is not a bracket', bad(() => createBracket(names(2))));
check(`more than ${MAX_ENTRANTS} is refused`, bad(() => createBracket(names(40))));
check('duplicates are collapsed, not counted twice',
  createBracket(['a', 'a', 'b', 'c', 'd']).entrants.length === 4);
check('reporting an unknown match throws',
  bad(() => reportResult(eight, 'W9-9', 'a')));
check('reporting someone not in the match throws',
  bad(() => reportResult(eight, 'W1-1', 'zzz')));
check('reporting a match twice throws', bad(() => {
  const once = reportResult(eight, 'W1-1', 'a');
  reportResult(once, 'W1-1', 'h');
}));
check('reporting a match missing a player throws',
  bad(() => reportResult(eight, 'W2-1', 'a')));

console.log('\n--- reporting does not edit the old bracket ---');
// The storage layer overwrites rather than merges, which only holds if
// reporting hands back something new.
const before = createBracket(names(4));
const after = reportResult(before, 'W1-1', before.matches[0].a);
check('the original is untouched', before.matches[0].winner === null);
check('the new one has the result', after.matches[0].winner !== null);

console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
