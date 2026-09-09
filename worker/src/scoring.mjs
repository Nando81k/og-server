export function scoreWeek({ games, picks }) {
  const byId = new Map(games.map((g) => [g.id, g]));
  let points = 0;
  let correct = 0;
  let possible = 0;

  for (const game of games) {
    if (game.voided || !game.completed) continue;
    const pick = picks.find((p) => p.game_id === game.id);
    if (pick) possible += pick.confidence;
    if (pick && pick.team === game.winner) {
      points += pick.confidence;
      correct += 1;
    }
  }
  // A pick naming a game outside this week scores nothing; byId guards reads.
  void byId;
  return { points, correct, possible };
}

export function buildStandings(rows) {
  const totals = new Map();
  for (const r of rows) {
    const t = totals.get(r.userId) ?? { userId: r.userId, points: 0, correct: 0, weeks: 0 };
    t.points += r.points;
    t.correct += r.correct;
    t.weeks += 1;
    totals.set(r.userId, t);
  }
  return [...totals.values()].sort(
    (a, b) => b.points - a.points || b.correct - a.correct || (a.userId < b.userId ? -1 : 1)
  );
}
