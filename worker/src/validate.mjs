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

  for (const p of submission) {
    const game = byId.get(p.game_id);
    if (!game) return bad('That slate includes a game that is not in this week.');
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
