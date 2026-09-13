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

/**
 * Score a whole season from stored weeks.
 *
 * Takes the data rather than fetching it, so the weekly job can pass this
 * week's results straight from memory — they are not written down until after
 * the posts succeed — while /leaderboard passes what the database holds. One
 * definition of the standings, two callers, no chance of them disagreeing
 * about what someone's total is.
 *
 * A week with no games is skipped rather than counted as played. That count is
 * what "entered every week" is measured against, and a season bootstrapped
 * mid-way has earlier weeks that never existed.
 */
export function scoreSeason(weeks) {
  const rows = [];
  let weeksPlayed = 0;

  for (const { week, games, picks } of weeks ?? []) {
    if (!games || games.length === 0) continue;
    weeksPlayed += 1;

    const byUser = new Map();
    for (const p of picks ?? []) {
      if (!byUser.has(p.userId)) byUser.set(p.userId, []);
      byUser.get(p.userId).push(p);
    }

    for (const [userId, theirs] of byUser) {
      const { points, correct } = scoreWeek({ games, picks: theirs });
      rows.push({ userId, points, correct, week });
    }
  }

  return { rows, weeksPlayed };
}
