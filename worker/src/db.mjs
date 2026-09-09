export async function upsertGames(db, season, week, games) {
  for (const g of games) {
    await db
      .prepare(
        `INSERT INTO games (id, season, week, kickoff, home, away, winner, voided)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         -- upsertGames owns schedule fields (kickoff); setResults owns result
         -- fields (winner, voided). Updating only kickoff on conflict is
         -- deliberate: the sync job re-runs upsertGames for the upcoming,
         -- unplayed week, so a re-sync must never be able to discard a
         -- winner already recorded by setResults.
         ON CONFLICT(id) DO UPDATE SET kickoff = excluded.kickoff`
      )
      .bind(g.id, season, week, g.kickoff, g.home, g.away, g.winner ?? null, g.voided ? 1 : 0)
      .run();
  }
}

export async function getGames(db, season, week) {
  const { results } = await db
    .prepare(`SELECT * FROM games WHERE season = ? AND week = ? ORDER BY kickoff, id`)
    .bind(season, week)
    .all();
  return (results ?? []).map((r) => ({ ...r, voided: r.voided === 1, completed: r.winner !== null || r.voided === 1 }));
}

export async function setResults(db, season, week, games) {
  // Scoped to season/week: a game postponed out of a week and voided there
  // must never have its winner rewritten by a later week's feed reusing the
  // same ESPN event id against a row still stamped with the old week.
  for (const g of games) {
    await db
      .prepare(`UPDATE games SET winner = ?, voided = ? WHERE id = ? AND season = ? AND week = ?`)
      .bind(g.winner ?? null, g.voided ? 1 : 0, g.id, season, week)
      .run();
  }
}

export async function savePicks(db, { userId, season, week, picks }) {
  // DELETE-then-INSERT is issued as one db.batch() call so D1 runs it as a
  // single transaction: a failure part-way through can't leave a user's week
  // deleted but only partly rewritten.
  const statements = [
    db.prepare(`DELETE FROM picks WHERE user_id = ? AND season = ? AND week = ?`)
      .bind(userId, season, week),
    ...picks.map((p) =>
      db.prepare(
        `INSERT INTO picks (user_id, game_id, season, week, team, confidence)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(userId, p.game_id, season, week, p.team, p.confidence)
    ),
  ];
  await db.batch(statements);
}

export async function getPicks(db, userId, season, week) {
  const { results } = await db
    .prepare(`SELECT game_id, team, confidence FROM picks WHERE user_id = ? AND season = ? AND week = ?`)
    .bind(userId, season, week)
    .all();
  return results ?? [];
}

export async function allPicks(db, season, week) {
  const { results } = await db
    .prepare(
      `SELECT user_id AS userId, game_id, team, confidence
       FROM picks WHERE season = ? AND week = ?`
    )
    .bind(season, week)
    .all();
  return results ?? [];
}

export async function openWeek(db, season) {
  const { results } = await db
    .prepare(
      `SELECT MIN(week) AS week FROM games WHERE season = ? AND winner IS NULL AND voided = 0`
    )
    .bind(season)
    .all();
  return results?.[0]?.week ?? null;
}
