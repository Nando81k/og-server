/**
 * A tournament: the bracket engine, plus everything around it that the engine
 * deliberately does not know about — who is signed up, what a placing is worth,
 * and how any of it reads in Discord.
 *
 * The engine in bracket.mjs is pure and knows only opaque player ids. This
 * module is the layer that turns those ids into names, results into season
 * points, and a 63-match structure into something that fits in a chat message.
 *
 * Nothing here touches the database. Storage lives in db.mjs and passes the
 * two stored fields — the seed order and the list of reported results — back
 * through `replay` to rebuild the bracket.
 */

import {
  createBracket, reportResult, openMatches, isComplete, placements,
  MIN_ENTRANTS, MAX_ENTRANTS,
} from './bracket.mjs';

export { MIN_ENTRANTS, MAX_ENTRANTS };

/**
 * What a placing is worth on the season leaderboard.
 *
 * Deliberately a flat table rather than something that scales with the size of
 * the field. This server runs 8-to-16 player brackets; a formula that makes
 * winning a 12-person tournament worth a different number from winning an
 * 11-person one is arithmetic nobody can do in their head, and the whole point
 * of a points table is that people can see what they are playing for.
 *
 * Scaled against the pick'em, where a good week is roughly 100 points. Winning
 * a bracket is a real night's work and is worth about half of that; the two
 * points for turning up exist because an empty bracket is the actual failure
 * mode, not an unfair one.
 */
export const PLACEMENT_POINTS = [
  { upTo: 1, points: 50, label: 'won it' },
  { upTo: 2, points: 30, label: 'runner up' },
  { upTo: 3, points: 20, label: '3rd' },
  { upTo: 4, points: 12, label: '4th' },
  { upTo: 8, points: 6, label: 'top 8' },
  { upTo: Infinity, points: 2, label: 'entered' },
];

/** What one placing earns. `place` is the joint placing, so 5th of two 5ths. */
export function pointsFor(place) {
  const row = PLACEMENT_POINTS.find((r) => place <= r.upTo);
  return { points: row.points, label: row.label };
}

/**
 * Fix the seed order for a tournament.
 *
 * Randomised, not ranked. Seeding by season standings would be defensible and
 * is what a real tournament does, but it also means the person having a good
 * month gets an easier bracket every time, and in a group this size that reads
 * as rigged long before it reads as earned. A draw nobody can argue with beats
 * a seeding everybody can.
 *
 * `rand` is injectable so a test can pin the draw.
 */
export function drawSeeds(userIds, rand = Math.random) {
  const out = [...new Set(userIds)];
  // Fisher-Yates, from the end, so every order is equally likely.
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Rebuild the live bracket from what is stored.
 *
 * The database keeps the seed order and an ordered list of results, never the
 * bracket itself. The engine is pure and `createBracket` is deterministic, so
 * replaying is exact — and it makes an undo trivially correct: drop the last
 * result and replay, rather than trying to reverse a cascade through the
 * losers bracket and the grand final by hand.
 */
export function replay(seeds, results) {
  let bracket = createBracket(seeds);
  for (const r of results ?? []) {
    bracket = reportResult(bracket, r.match, r.winner);
  }
  return bracket;
}

/** Who may report a match: either player in it, or a mod. */
export function canReport(match, userId, { isMod = false } = {}) {
  if (isMod) return true;
  return match.a === userId || match.b === userId;
}

const nameOf = (names, id) => names?.[id] ?? 'someone';

/** `W2-1 — Nando vs Mike`, the line a match reads as everywhere. */
export function matchLabel(match, names) {
  return `${match.id} — ${nameOf(names, match.a)} vs ${nameOf(names, match.b)}`;
}

/**
 * Open matches as Discord autocomplete choices.
 *
 * Discord allows 25 choices and 100 characters per name, and gives the whole
 * interaction about three seconds — which is why entrant names are stored at
 * sign-up rather than fetched from the API here.
 */
export function reportChoices(bracket, names, typed = '') {
  const q = String(typed ?? '').toLowerCase();
  return openMatches(bracket)
    .map((m) => ({ name: matchLabel(m, names).slice(0, 100), value: m.id }))
    .filter((c) => !q || c.name.toLowerCase().includes(q))
    .slice(0, 25);
}

const mention = (id) => `<@${id}>`;

/** Trim a list to `max` entries, with a line saying what was left out. */
function capped(lines, max, noun) {
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max), `…and ${lines.length - max} more ${noun}`];
}

/** The sign-up post: who is in, and what is still needed to start. */
export function signupMessage({ name, entrants }) {
  const lines = [`**${name}** — sign-ups open`, ''];
  if (entrants.length === 0) {
    lines.push('Nobody yet. `/bracket join` to be first.');
  } else {
    lines.push(...capped(entrants.map((e, i) => `${i + 1}. ${mention(e.userId)}`), 32, 'entrants'));
  }
  lines.push('');
  lines.push(
    entrants.length < MIN_ENTRANTS
      ? `${MIN_ENTRANTS - entrants.length} more needed before this can start.`
      : `${entrants.length} in. A mod runs \`/bracket start\` to draw the bracket.`
  );
  return lines.join('\n');
}

/**
 * The running bracket.
 *
 * Shows what to go and play, not the whole structure — a 32-player double
 * elimination bracket is 63 matches and will not fit in a Discord message, and
 * the only question anyone actually has is who they play next.
 */
export function bracketMessage({ name, bracket }) {
  const open = openMatches(bracket);
  const played = bracket.matches.filter((m) => m.winner && !m.bye).length;
  const total = bracket.matches.filter((m) => !m.bye && m.id !== 'GF2').length;

  const lines = [`**${name}** — ${played} of ${total} matches played`, ''];

  if (open.length === 0) {
    lines.push('Nothing playable right now — waiting on a result to come in.');
  } else {
    lines.push('**Play these now**');
    lines.push(...capped(
      open.map((m) => `\`${m.id}\` ${mention(m.a)} vs ${mention(m.b)}`),
      16,
      'matches'
    ));
  }

  // Knocked out means beaten in the losers bracket: everyone else is either
  // still in the winners bracket or has one life left.
  const out = new Set();
  for (const m of bracket.matches) {
    if (m.bracket !== 'L' || !m.winner || m.bye) continue;
    out.add(m.winner === m.a ? m.b : m.a);
  }
  const alive = bracket.entrants.length - out.size;
  lines.push('');
  lines.push(`${bracket.entrants.length} entrants · ${alive} still alive`);
  lines.push('Report with `/bracket report`. One unreported set stalls everyone behind it.');
  return lines.join('\n');
}

/** The final standings, with what each placing earned. */
export function resultsMessage({ name, bracket }) {
  const lines = [`**${name}** — final`, ''];
  for (const p of placements(bracket)) {
    const { points } = pointsFor(p.place);
    lines.push(`**${p.place}.** ${mention(p.userId)} · +${points}`);
  }
  lines.push('');
  lines.push('Points are on the season leaderboard.');
  return lines.join('\n');
}

/** Every award a finished bracket owes, ready for the points ledger. */
export function awardsFor(bracket, tournamentName) {
  return placements(bracket).map((p) => {
    const { points, label } = pointsFor(p.place);
    return { userId: p.userId, amount: points, reason: `${tournamentName} — ${label}` };
  });
}

export { openMatches, isComplete, placements };
