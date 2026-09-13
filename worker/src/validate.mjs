export function lockTime(games) {
  return Math.min(...games.map((g) => Date.parse(g.kickoff)));
}

export function validateSubmission({ games, submission, now }) {
  const n = games.length;
  const bad = (error) => ({ ok: false, error });

  if (!Array.isArray(submission)) return bad('That submission was not readable.');
  if (now >= lockTime(games)) {
    return bad('Picks are locked — the first game of the week has kicked off.');
  }
  if (submission.length !== n) return bad(`Pick every game — all ${n} of them.`);

  const byId = new Map(games.map((g) => [g.id, g]));
  const seen = new Set();
  const seenGames = new Set();

  for (const p of submission) {
    if (!p || typeof p !== 'object') return bad('That submission was not readable.');
    const game = byId.get(p.game_id);
    if (!game) return bad('That slate includes a game that is not in this week.');
    if (seenGames.has(p.game_id)) {
      return bad('Each game can be picked only once.');
    }
    seenGames.add(p.game_id);
    if (p.team !== game.home && p.team !== game.away) {
      return bad(`${p.team} is not playing in that game.`);
    }
    if (!Number.isInteger(p.confidence) || p.confidence < 1 || p.confidence > n) {
      return bad(`Confidence has to be a whole number from 1 to ${n}.`);
    }
    if (seen.has(p.confidence)) {
      return bad('Each confidence value can be used only once.');
    }
    seen.add(p.confidence);
  }
  return { ok: true, picks: submission };
}

/** MANAGE_MESSAGES is bit 13; ADMINISTRATOR (bit 3) implies every permission. */
const MANAGE_MESSAGES = 1n << 13n;
const ADMINISTRATOR = 1n << 3n;

/**
 * Whether the member who ran a command may hand out season points.
 *
 * Discord sends the invoker's resolved permissions as a decimal string. An
 * absent or unparseable value is treated as no permission: a command that
 * changes the standings should fail closed.
 */
export function hasManageMessages(member) {
  let bits;
  try {
    bits = BigInt(member?.permissions ?? '0');
  } catch {
    return false;
  }
  return (bits & ADMINISTRATOR) !== 0n || (bits & MANAGE_MESSAGES) !== 0n;
}

/** Longest reason that still reads well on a leaderboard line. */
export const MAX_REASON = 120;
/** Bound on a single award, so a slipped keypress cannot decide the season. */
export const MAX_AWARD = 500;

/**
 * Check an /award before it reaches the ledger.
 *
 * The ledger is append-only and public, so a bad row is not quietly fixed
 * later — it is corrected by a second, visible row. Better to reject it here.
 */
export function validateAward({ points, reason }) {
  const bad = (error) => ({ ok: false, error });

  if (!Number.isInteger(points)) return bad('Points have to be a whole number.');
  if (points === 0) return bad('Zero points would not change anything.');
  if (Math.abs(points) > MAX_AWARD) {
    return bad(`That is more than ${MAX_AWARD} points — check the number.`);
  }

  const tidy = String(reason ?? '').trim().replace(/\s+/g, ' ');
  if (!tidy) return bad('Say what the points are for — it shows on the leaderboard.');
  if ([...tidy].length > MAX_REASON) {
    return bad(`Keep the reason under ${MAX_REASON} characters.`);
  }

  return { ok: true, points, reason: tidy };
}
