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

/** Record one award. Nothing is ever updated in place — see schema.sql. */
export async function awardPoints(db, { season, userId, amount, reason, awardedBy, now }) {
  await db
    .prepare(
      `INSERT INTO points (season, user_id, amount, reason, awarded_by, awarded_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(season, userId, amount, reason, awardedBy, now ?? new Date().toISOString())
    .run();
}

/**
 * Every award this season, already summed per person.
 *
 * Summed in SQL rather than in the worker because the ledger only grows, and
 * the leaderboard only ever needs the totals.
 */
export async function seasonAwards(db, season) {
  const { results } = await db
    .prepare(
      `SELECT user_id, SUM(amount) AS points
         FROM points
        WHERE season = ?
        GROUP BY user_id`
    )
    .bind(season)
    .all();
  return (results ?? []).map((r) => ({ userId: r.user_id, points: Number(r.points) || 0 }));
}

// --- tournaments -----------------------------------------------------------

const parse = (text, fallback) => {
  try {
    const v = JSON.parse(text);
    return v ?? fallback;
  } catch {
    return fallback;
  }
};

const shape = (r) => (r ? {
  id: r.id,
  season: r.season,
  name: r.name,
  status: r.status,
  seeds: r.seeds ? parse(r.seeds, null) : null,
  results: parse(r.results, []),
  channelId: r.channel_id ?? null,
  createdBy: r.created_by,
  createdAt: r.created_at,
  // The exact stored text the next write has to match. See recordResult.
  resultsRaw: r.results,
} : null);

/**
 * The tournament the bracket commands act on, or null.
 *
 * There is deliberately no id option on any of them. One tournament runs at a
 * time and `/bracket create` refuses while another is still open, which keeps
 * every other subcommand down to almost no arguments. A group this size runs
 * one bracket a night, and an id nobody can remember is a worse tax than the
 * restriction.
 */
export async function activeTournament(db, season) {
  const { results } = await db
    .prepare(
      `SELECT * FROM tournaments
        WHERE season = ? AND status IN ('signup', 'running')
        ORDER BY created_at DESC LIMIT 1`
    )
    .bind(season)
    .all();
  return shape(results?.[0]);
}

export async function getTournament(db, id) {
  const { results } = await db.prepare(`SELECT * FROM tournaments WHERE id = ?`).bind(id).all();
  return shape(results?.[0]);
}

export async function createTournament(db, { id, season, name, channelId, createdBy, now }) {
  await db
    .prepare(
      `INSERT INTO tournaments (id, season, name, status, results, channel_id, created_by, created_at)
       VALUES (?, ?, ?, 'signup', '[]', ?, ?, ?)`
    )
    .bind(id, season, name, channelId ?? null, createdBy, now ?? new Date().toISOString())
    .run();
  return id;
}

export async function tournamentEntrants(db, id) {
  const { results } = await db
    .prepare(
      `SELECT user_id, display_name FROM tournament_entrants
        WHERE tournament_id = ? ORDER BY joined_at, user_id`
    )
    .bind(id)
    .all();
  return (results ?? []).map((r) => ({ userId: r.user_id, displayName: r.display_name }));
}

/** Idempotent: joining twice is a no-op, not an error and not a second seat. */
export async function joinTournament(db, id, { userId, displayName, now }) {
  await db
    .prepare(
      `INSERT INTO tournament_entrants (tournament_id, user_id, display_name, joined_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(tournament_id, user_id) DO UPDATE SET display_name = excluded.display_name`
    )
    .bind(id, userId, displayName, now ?? new Date().toISOString())
    .run();
}

export async function leaveTournament(db, id, userId) {
  const res = await db
    .prepare(`DELETE FROM tournament_entrants WHERE tournament_id = ? AND user_id = ?`)
    .bind(id, userId)
    .run();
  return (res?.meta?.changes ?? 0) > 0;
}

/** Fix the draw and open the bracket. Refuses if it has already been drawn. */
export async function startTournament(db, id, seeds) {
  const res = await db
    .prepare(
      `UPDATE tournaments SET status = 'running', seeds = ?
        WHERE id = ? AND status = 'signup'`
    )
    .bind(JSON.stringify(seeds), id)
    .run();
  return (res?.meta?.changes ?? 0) > 0;
}

/**
 * Append a result, but only if nobody else has appended one since it was read.
 *
 * Two people finishing sets at the same moment both read the same results
 * list, and a plain overwrite would let the second write erase the first —
 * losing a reported match, which stalls everyone behind it and looks exactly
 * like somebody forgetting to report. Comparing against the previous stored
 * text makes that a visible retry instead of silent data loss.
 */
export async function recordResult(db, id, previousRaw, results) {
  const res = await db
    .prepare(`UPDATE tournaments SET results = ? WHERE id = ? AND results = ?`)
    .bind(JSON.stringify(results), id, previousRaw)
    .run();
  return (res?.meta?.changes ?? 0) > 0;
}

export async function closeTournament(db, id, status) {
  await db.prepare(`UPDATE tournaments SET status = ? WHERE id = ?`).bind(status, id).run();
}
