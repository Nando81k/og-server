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

export async function upsertTeams(db, teams) {
  for (const t of teams) {
    await db
      .prepare(
        `INSERT INTO teams (abbr, name, short_name, logo, color, alt_color)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(abbr) DO UPDATE SET
           name = excluded.name,
           short_name = excluded.short_name,
           logo = excluded.logo,
           color = excluded.color,
           alt_color = excluded.alt_color`
      )
      .bind(t.abbr, t.name, t.shortName, t.logo, t.color, t.altColor)
      .run();
  }
}

/** Keyed by abbreviation, which is how games rows refer to a team. */
export async function getTeams(db) {
  const { results } = await db.prepare(`SELECT * FROM teams`).all();
  const out = {};
  for (const r of results ?? []) {
    out[r.abbr] = {
      abbr: r.abbr,
      name: r.name,
      shortName: r.short_name,
      logo: r.logo,
      color: r.color,
      altColor: r.alt_color,
    };
  }
  return out;
}

/**
 * A done-marker for a step the weekly job must do exactly once.
 *
 * Returns true when the mark was already there. Writing the winners for a
 * week is what advances openWeek, so it cannot double as "this week has been
 * announced" — a post that failed after that write would otherwise be
 * unrepeatable, and a post that succeeded before a later failure would
 * otherwise be repeated.
 */
export async function alreadyDone(db, key) {
  const { results } = await db
    .prepare(`SELECT value FROM meta WHERE key = ?`)
    .bind(key)
    .all();
  return Boolean(results?.[0]);
}

export async function markDone(db, key, value = new Date().toISOString()) {
  await db
    .prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING`)
    .bind(key, value)
    .run();
}
