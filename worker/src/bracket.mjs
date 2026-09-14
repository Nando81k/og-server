/**
 * Double elimination brackets, as pure functions.
 *
 * No storage and no Discord in here — a bracket is data in, data out, so the
 * wiring can be tested exhaustively. Getting the losers bracket wrong is the
 * classic way these break, and it breaks silently: the bracket still *runs*,
 * people just end up playing the wrong opponents and nobody notices until the
 * final is between two players who should have met in round two.
 *
 * The whole bracket is generated up front — every match, and where each
 * match's winner and loser go next. Reporting a result fills in a name and
 * pushes it along the wiring. Nothing is computed twice, and the shape of the
 * bracket never depends on who has won so far.
 *
 * Match ids read as their position: W2-1 is winners round 2, first match.
 * L3-2 is losers round 3, second. GF and GF2 are the grand final and its
 * reset.
 */

/**
 * A slot that will never hold a player.
 *
 * Distinct from null, which means "waiting on a result". The difference
 * matters: a match waiting on a real player must sit open, and a match waiting
 * on a bye must resolve itself. Conflating the two is what makes a bracket
 * with an odd number of entrants stall forever on a losers-bracket match whose
 * opponent was never going to arrive.
 *
 * Not a possible Discord snowflake, so it can never collide with a real id.
 */
export const BYE = '__bye__';

/** The most entrants worth running this way. 32 is five winners rounds. */
export const MAX_ENTRANTS = 32;
/** Fewer than this is not a bracket, it is a set. */
export const MIN_ENTRANTS = 3;

/**
 * Standard bracket seed order, so the top two seeds can only meet in the
 * final and each half is balanced.
 *
 *   4 -> [1, 4, 2, 3]
 *   8 -> [1, 8, 4, 5, 2, 7, 3, 6]
 *
 * Built by mirroring: every seed s in a bracket of n is paired against
 * 2n+1-s in the bracket of 2n.
 */
export function seedOrder(size) {
  let order = [1];
  for (let n = 1; n < size; n *= 2) {
    const next = [];
    for (const s of order) {
      next.push(s, 2 * n + 1 - s);
    }
    order = next;
  }
  return order;
}

/** Smallest power of two that fits everyone. The remainder become byes. */
export function bracketSize(count) {
  let size = 1;
  while (size < count) size *= 2;
  return size;
}

/**
 * Build every match and its wiring for `players`, in seed order.
 *
 * Players are taken as given — seed 1 first. A bracket that is not a power of
 * two is padded with byes, and a bye is resolved immediately rather than left
 * as a match nobody can report.
 */
export function createBracket(players) {
  const entrants = [...new Set(players ?? [])];
  if (entrants.length < MIN_ENTRANTS) {
    throw new Error(`A bracket needs at least ${MIN_ENTRANTS} entrants.`);
  }
  if (entrants.length > MAX_ENTRANTS) {
    throw new Error(`A bracket holds at most ${MAX_ENTRANTS} entrants.`);
  }

  const size = bracketSize(entrants.length);
  const rounds = Math.log2(size);
  const matches = [];
  const add = (m) => {
    matches.push({ a: null, b: null, winner: null, next: null, drop: null, ...m });
    return matches[matches.length - 1];
  };

  // --- winners bracket -----------------------------------------------------
  const order = seedOrder(size);
  for (let r = 1; r <= rounds; r += 1) {
    const count = size / 2 ** r;
    for (let s = 1; s <= count; s += 1) add({ id: `W${r}-${s}`, bracket: 'W', round: r, slot: s });
  }

  // Seat round one by seed order; a seed past the entrant list is a bye.
  const seatOf = (seed) => entrants[seed - 1] ?? BYE;
  for (let s = 1; s <= size / 2; s += 1) {
    const m = byId(matches, `W1-${s}`);
    m.a = seatOf(order[(s - 1) * 2]);
    m.b = seatOf(order[(s - 1) * 2 + 1]);
  }

  // --- losers bracket ------------------------------------------------------
  // Two kinds of round, alternating. A "drop" round pairs survivors against
  // players just knocked out of the winners bracket; a "consolidation" round
  // pairs survivors against each other to halve them again. Round one is the
  // exception: it is only the first wave of winners-round-one losers.
  const lbRounds = [];
  if (rounds >= 2) {
    lbRounds.push({ round: 1, count: size / 4, kind: 'first' });
    let n = 2;
    for (let i = 2; i <= rounds; i += 1) {
      lbRounds.push({ round: n, count: size / 2 ** i, kind: 'drop', from: i });
      n += 1;
      const consolidated = size / 2 ** (i + 1);
      if (consolidated >= 1) {
        lbRounds.push({ round: n, count: consolidated, kind: 'consolidate' });
        n += 1;
      }
    }
  }
  for (const { round, count } of lbRounds) {
    for (let s = 1; s <= count; s += 1) add({ id: `L${round}-${s}`, bracket: 'L', round, slot: s });
  }

  // --- grand final ---------------------------------------------------------
  // GF2 only ever gets played if the losers-bracket player wins GF. They had
  // to lose twice; the winners-bracket player has not lost at all yet.
  add({ id: 'GF', bracket: 'GF', round: 1, slot: 1 });
  add({ id: 'GF2', bracket: 'GF', round: 2, slot: 1, reset: true });

  wire(matches, { size, rounds, lbRounds });
  for (const m of matches) resolveByes(matches, m);
  return { size, rounds, entrants, matches };
}

/** Point every match's winner and loser at where they go next. */
function wire(matches, { rounds, lbRounds }) {
  const set = (id, field, value) => {
    const m = byId(matches, id);
    if (m) m[field] = value;
  };

  // Winners advance up their own bracket; the last one meets the grand final.
  for (let r = 1; r < rounds; r += 1) {
    for (const m of matches.filter((x) => x.bracket === 'W' && x.round === r)) {
      set(m.id, 'next', { match: `W${r + 1}-${Math.ceil(m.slot / 2)}`, slot: m.slot % 2 === 1 ? 'a' : 'b' });
    }
  }
  set(`W${rounds}-1`, 'next', { match: 'GF', slot: 'a' });

  // Losers drop into the losers bracket. Round one losers fill its first
  // round two at a time; later rounds each feed one "drop" round.
  const dropRoundFor = (wbRound) =>
    wbRound === 1 ? lbRounds.find((l) => l.kind === 'first') : lbRounds.find((l) => l.kind === 'drop' && l.from === wbRound);

  for (let r = 1; r <= rounds; r += 1) {
    const target = dropRoundFor(r);
    if (!target) continue;
    const losers = matches.filter((x) => x.bracket === 'W' && x.round === r);
    losers.forEach((m, i) => {
      if (r === 1) {
        set(m.id, 'drop', { match: `L1-${Math.ceil((i + 1) / 2)}`, slot: i % 2 === 0 ? 'a' : 'b' });
      } else {
        // Reverse the order so a player dropping out does not immediately
        // re-meet someone from their own half of the winners bracket.
        const slotIndex = losers.length - 1 - i;
        set(m.id, 'drop', { match: `L${target.round}-${slotIndex + 1}`, slot: 'b' });
      }
    });
  }

  // Inside the losers bracket, winners advance to the next losers round.
  for (let i = 0; i < lbRounds.length; i += 1) {
    const here = lbRounds[i];
    const after = lbRounds[i + 1];
    for (const m of matches.filter((x) => x.bracket === 'L' && x.round === here.round)) {
      if (!after) {
        set(m.id, 'next', { match: 'GF', slot: 'b' });
      } else if (after.kind === 'consolidate') {
        set(m.id, 'next', { match: `L${after.round}-${Math.ceil(m.slot / 2)}`, slot: m.slot % 2 === 1 ? 'a' : 'b' });
      } else {
        set(m.id, 'next', { match: `L${after.round}-${m.slot}`, slot: 'a' });
      }
    }
  }

  set('GF', 'next', null);
  set('GF2', 'next', null);
}

function byId(matches, id) {
  return matches.find((m) => m.id === id);
}

/**
 * A match with one player and one bye is already decided.
 *
 * Resolved at creation rather than left for someone to report, because a match
 * against nobody is not a match and waiting on it would stall the bracket.
 */
function resolveByes(matches, m) {
  if (m.winner) return;
  // Still waiting on a real result somewhere upstream.
  if (m.a === null || m.b === null) return;
  // Two real players: this one has to actually be played.
  if (m.a !== BYE && m.b !== BYE) return;

  // One bye advances the other player. Two byes advance the bye itself, which
  // is how an empty quarter of the bracket collapses instead of stalling.
  const through = m.a === BYE ? m.b : m.a;
  m.winner = through;
  m.bye = true;
  advance(matches, m, through, BYE);
}

/** Push a decided match's players along the wiring. */
function advance(matches, m, winner, loser) {
  if (m.next && winner !== null) {
    const target = byId(matches, m.next.match);
    if (target) target[m.next.slot] = winner;
  }
  if (m.drop && loser !== null) {
    const target = byId(matches, m.drop.match);
    if (target) target[m.drop.slot] = loser;
  }
  // Filling a slot can decide another match, which fills another slot. Repeat
  // until nothing more resolves rather than assuming one pass is enough.
  for (let again = true; again; ) {
    again = false;
    for (const other of matches) {
      const before = other.winner;
      resolveByes(matches, other);
      if (other.winner !== before) again = true;
    }
  }
}

/**
 * Record a winner and move everyone along.
 *
 * Returns a new bracket rather than editing the old one, so a caller holding
 * the previous state still has it — which is what makes the storage layer's
 * job a plain overwrite rather than a merge.
 */
export function reportResult(bracket, matchId, winnerId) {
  const next = structuredClone(bracket);
  const m = byId(next.matches, matchId);
  if (!m) throw new Error(`No match ${matchId} in this bracket.`);
  if (m.winner) throw new Error(`${matchId} already has a result.`);
  if (m.a === null || m.b === null) throw new Error(`${matchId} does not have both players yet.`);
  if (winnerId !== m.a && winnerId !== m.b) {
    throw new Error(`${winnerId} is not in ${matchId}.`);
  }

  m.winner = winnerId;
  const loser = winnerId === m.a ? m.b : m.a;

  // The grand final only continues if the losers-bracket player wins it.
  if (m.id === 'GF' && winnerId === m.b) {
    const reset = byId(next.matches, 'GF2');
    reset.a = m.a;
    reset.b = m.b;
  }

  advance(next.matches, m, winnerId, loser);
  return next;
}

/** Matches with both players seated and no result yet — what to go play. */
export function openMatches(bracket) {
  return (bracket?.matches ?? []).filter(
    (m) => !m.winner && real(m.a) && real(m.b) && !skipped(bracket, m)
  );
}

/** A seated, actual player — not an empty slot and not a bye. */
function real(x) {
  return x !== null && x !== BYE;
}

/** GF2 is only live once the losers player has won GF. */
function skipped(bracket, m) {
  if (m.id !== 'GF2') return false;
  const gf = byId(bracket.matches, 'GF');
  return !gf?.winner || gf.winner === gf.a;
}

export function isComplete(bracket) {
  const gf = byId(bracket?.matches ?? [], 'GF');
  if (!gf?.winner) return false;
  if (gf.winner === gf.a) return true;
  return Boolean(byId(bracket.matches, 'GF2')?.winner);
}

/**
 * Final placings, best first, once the bracket is done.
 *
 * Worked out from when someone was knocked out: the later you lost your second
 * match, the higher you placed. Everyone eliminated in the same losers round
 * shares a placing, which is how brackets are normally reported — joint 5th is
 * a real result, not a tie that needs breaking.
 */
export function placements(bracket) {
  if (!isComplete(bracket)) return [];

  const gf = byId(bracket.matches, 'GF');
  const gf2 = byId(bracket.matches, 'GF2');
  const champion = gf.winner === gf.a ? gf.winner : gf2.winner;
  const runnerUp = champion === gf.a ? gf.b : gf.a;

  // Everyone else is ranked by how deep into the losers bracket they got.
  const knockedOutIn = new Map();
  for (const m of bracket.matches) {
    if (m.bracket !== 'L' || !m.winner) continue;
    const loser = m.winner === m.a ? m.b : m.a;
    if (real(loser)) knockedOutIn.set(loser, m.round);
  }

  const rest = [...knockedOutIn.entries()]
    .filter(([id]) => id !== champion && id !== runnerUp)
    .sort((x, y) => y[1] - x[1]);

  const out = [
    { userId: champion, place: 1 },
    { userId: runnerUp, place: 2 },
  ];

  let place = 3;
  let i = 0;
  while (i < rest.length) {
    const round = rest[i][1];
    const sameRound = rest.filter(([, r]) => r === round);
    for (const [userId] of sameRound) out.push({ userId, place });
    place += sameRound.length;
    i += sameRound.length;
  }
  return out;
}
