export function scoreWeek({ games, picks }) {
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

/**
 * Fold hand-awarded points into pick'em standings.
 *
 * Kept separate from buildStandings rather than fed through it, because a row
 * there also counts as a week entered. Awards are not weeks: someone who wins
 * a tournament and never touches the pick'em has not "entered every week", and
 * running them through the same path would quietly claim they had.
 *
 * Someone with awards and no picks still belongs on the board — they scored
 * season points — so they are added with zero correct picks and zero weeks.
 */
export function mergeAwards(standings, awards) {
  const totals = new Map((standings ?? []).map((r) => [r.userId, { ...r }]));
  for (const a of awards ?? []) {
    const existing = totals.get(a.userId);
    if (existing) existing.points += a.points;
    else totals.set(a.userId, { userId: a.userId, points: a.points, correct: 0, weeks: 0 });
  }
  return [...totals.values()].sort(
    (a, b) => b.points - a.points || b.correct - a.correct || (a.userId < b.userId ? -1 : 1)
  );
}
