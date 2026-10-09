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

// --- fantasy trades ---------------------------------------------------------

/** Every status a trade can still move out of. */
export const LIVE_TRADE_STATUSES = ['open', 'approved', 'flagged', 'no_quorum'];

const tradeShape = (r) => (r ? {
  id: r.id,
  season: r.season,
  proposerId: r.proposer_id,
  fromTeam: r.from_team,
  toTeam: r.to_team,
  fromName: r.from_name,
  toName: r.to_name,
  give: parse(r.give, []),
  get: parse(r.get, []),
  note: r.note ?? '',
  status: r.status,
  channelId: r.channel_id ?? null,
  messageId: r.message_id ?? null,
  createdAt: r.created_at,
  closesAt: r.closes_at,
} : null);

export async function getLink(db, season, userId) {
  const { results } = await db
    .prepare(`SELECT * FROM fantasy_links WHERE season = ? AND user_id = ?`)
    .bind(season, userId)
    .all();
  const r = results?.[0];
  return r ? { userId: r.user_id, teamId: r.team_id, teamName: r.team_name } : null;
}

export async function linkForTeam(db, season, teamId) {
  const { results } = await db
    .prepare(`SELECT * FROM fantasy_links WHERE season = ? AND team_id = ?`)
    .bind(season, teamId)
    .all();
  const r = results?.[0];
  return r ? { userId: r.user_id, teamId: r.team_id, teamName: r.team_name } : null;
}

/**
 * Claim a team. Refuses if someone else already holds it, unless `force` (a
 * mod reassigning), in which case the previous claim is dropped first.
 */
export async function linkTeam(db, { season, userId, teamId, teamName, force = false, now }) {
  const held = await linkForTeam(db, season, teamId);
  if (held && held.userId !== userId) {
    if (!force) return { ok: false, takenBy: held.userId };
    await db
      .prepare(`DELETE FROM fantasy_links WHERE season = ? AND team_id = ?`)
      .bind(season, teamId)
      .run();
  }
  await db
    .prepare(
      `INSERT INTO fantasy_links (user_id, season, team_id, team_name, linked_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, season) DO UPDATE SET team_id = excluded.team_id, team_name = excluded.team_name`
    )
    .bind(userId, season, teamId, teamName, now ?? new Date().toISOString())
    .run();
  return { ok: true };
}

export async function createTrade(db, t) {
  const res = await db
    .prepare(
      `INSERT INTO trades
         (season, proposer_id, from_team, to_team, from_name, to_name, give, get, note, status, created_at, closes_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
    )
    .bind(
      t.season, t.proposerId, t.fromTeam, t.toTeam, t.fromName, t.toName,
      JSON.stringify(t.give), JSON.stringify(t.get), t.note ?? '',
      t.createdAt, t.closesAt
    )
    .run();
  return res?.meta?.last_row_id;
}

export async function setTradeMessage(db, id, channelId, messageId) {
  await db
    .prepare(`UPDATE trades SET channel_id = ?, message_id = ? WHERE id = ?`)
    .bind(channelId, messageId, id)
    .run();
}

export async function getTrade(db, id) {
  const { results } = await db.prepare(`SELECT * FROM trades WHERE id = ?`).bind(id).all();
  return tradeShape(results?.[0]);
}

/** Trades whose players are still spoken for: everything not yet final. */
export async function liveTrades(db, season) {
  const { results } = await db
    .prepare(
      `SELECT * FROM trades
        WHERE season = ? AND status IN ('open', 'approved', 'flagged', 'no_quorum')
        ORDER BY id`
    )
    .bind(season)
    .all();
  return (results ?? []).map(tradeShape);
}

/** Open trades whose 24 hours are up. */
export async function dueTrades(db, nowIso) {
  const { results } = await db
    .prepare(`SELECT * FROM trades WHERE status = 'open' AND closes_at <= ? ORDER BY id`)
    .bind(nowIso)
    .all();
  return (results ?? []).map(tradeShape);
}

/**
 * Move a trade to a new status, but only out of one of `from`.
 *
 * Conditional so two things racing for the same trade (the close job and a
 * mod's override, say) cannot both win: the loser sees false and leaves it.
 */
export async function resolveTrade(db, id, from, to, now) {
  const marks = from.map(() => '?').join(', ');
  const res = await db
    .prepare(`UPDATE trades SET status = ?, resolved_at = ? WHERE id = ? AND status IN (${marks})`)
    .bind(to, now ?? new Date().toISOString(), id, ...from)
    .run();
  return (res?.meta?.changes ?? 0) > 0;
}

/** Idempotent per voter: voting again replaces the earlier vote. */
export async function castVote(db, tradeId, userId, vote, now) {
  await db
    .prepare(
      `INSERT INTO trade_votes (trade_id, user_id, vote, voted_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(trade_id, user_id) DO UPDATE SET vote = excluded.vote, voted_at = excluded.voted_at`
    )
    .bind(tradeId, userId, vote, now ?? new Date().toISOString())
    .run();
}

export async function tradeVotes(db, tradeId) {
  const { results } = await db
    .prepare(`SELECT user_id, vote FROM trade_votes WHERE trade_id = ?`)
    .bind(tradeId)
    .all();
  return (results ?? []).map((r) => ({ userId: r.user_id, vote: r.vote }));
}

// --- mock drafts -------------------------------------------------------------

const draftShape = (r) => (r ? {
  id: r.id,
  season: r.season,
  status: r.status,
  rounds: r.rounds,
  clockSeconds: r.clock_seconds,
  seats: parse(r.seats, []),
  seatsRaw: r.seats,
  pickNo: r.pick_no,
  deadline: r.deadline ?? null,
  channelId: r.channel_id ?? null,
  messageId: r.message_id ?? null,
  createdBy: r.created_by,
  createdAt: r.created_at,
} : null);

const pickShape = (r) => ({
  draftId: r.draft_id,
  pickNo: r.pick_no,
  teamId: r.team_id,
  playerId: r.player_id,
  name: r.player_name,
  position: r.position,
  proTeam: r.pro_team,
  auto: r.auto === 1,
  pickedAt: r.picked_at,
});

const poolShape = (r) => ({
  id: r.player_id,
  name: r.name,
  position: r.position,
  proTeam: r.pro_team,
  adp: r.adp,
});

export async function createDraft(db, { season, rounds, clockSeconds, seats, createdBy, now }) {
  const res = await db
    .prepare(
      `INSERT INTO drafts (season, status, rounds, clock_seconds, seats, pick_no, created_by, created_at)
       VALUES (?, 'lobby', ?, ?, ?, 1, ?, ?)`
    )
    .bind(season, rounds, clockSeconds, JSON.stringify(seats), createdBy, now ?? new Date().toISOString())
    .run();
  return res?.meta?.last_row_id;
}

export async function getDraft(db, id) {
  const { results } = await db.prepare(`SELECT * FROM drafts WHERE id = ?`).bind(id).all();
  return draftShape(results?.[0]);
}

/** The draft that is open or under way, if any. One at a time per season. */
export async function activeDraft(db, season) {
  const { results } = await db
    .prepare(`SELECT * FROM drafts WHERE season = ? AND status IN ('lobby', 'running') ORDER BY id DESC LIMIT 1`)
    .bind(season)
    .all();
  return draftShape(results?.[0]);
}

/** Every draft under way, across seasons: what the once-a-minute check works through. */
export async function runningDrafts(db) {
  const { results } = await db.prepare(`SELECT * FROM drafts WHERE status = 'running' ORDER BY id`).all();
  return (results ?? []).map(draftShape);
}

export async function setDraftMessage(db, id, channelId, messageId) {
  await db.prepare(`UPDATE drafts SET channel_id = ?, message_id = ? WHERE id = ?`).bind(channelId, messageId, id).run();
}

/**
 * Change who has which seat, but only if nobody else has since the seats were
 * read. Two people pressing Join in the same moment both read the same seats,
 * and a plain overwrite would drop one of them.
 */
export async function updateSeats(db, id, previousRaw, seats) {
  const res = await db
    .prepare(`UPDATE drafts SET seats = ? WHERE id = ? AND seats = ? AND status = 'lobby'`)
    .bind(JSON.stringify(seats), id, previousRaw)
    .run();
  return (res?.meta?.changes ?? 0) > 0;
}

/** Freeze the pool and start the draft, but only from the lobby. */
export async function beginDraft(db, id, { seats, deadline, pool }) {
  const res = await db
    .prepare(`UPDATE drafts SET status = 'running', seats = ?, pick_no = 1, deadline = ? WHERE id = ? AND status = 'lobby'`)
    .bind(JSON.stringify(seats), deadline ?? null, id)
    .run();
  if ((res?.meta?.changes ?? 0) === 0) return false;
  // 7 columns a row and D1 allows 100 bound values a statement, so a dozen rows each.
  const statements = [];
  for (let i = 0; i < pool.length; i += 12) {
    const chunk = pool.slice(i, i + 12);
    statements.push(
      db
        .prepare(
          `INSERT INTO draft_pool (draft_id, player_id, name, position, pro_team, adp) VALUES ` +
            chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')
        )
        .bind(...chunk.flatMap((p) => [id, p.id, p.name, p.position, p.proTeam, p.adp]))
    );
  }
  if (statements.length) await db.batch(statements);
  return true;
}

export async function setDraftStatus(db, id, from, to, now) {
  const marks = from.map(() => '?').join(', ');
  const res = await db
    .prepare(`UPDATE drafts SET status = ?, finished_at = ?, deadline = NULL WHERE id = ? AND status IN (${marks})`)
    .bind(to, now ?? new Date().toISOString(), id, ...from)
    .run();
  return (res?.meta?.changes ?? 0) > 0;
}

/** The best players still on the board, by ADP. */
export async function availablePlayers(db, draftId, limit = 5, term = '') {
  const like = term ? ` AND p.name LIKE ?` : '';
  const binds = term ? [draftId, draftId, `%${term}%`, limit] : [draftId, draftId, limit];
  const { results } = await db
    .prepare(
      `SELECT p.* FROM draft_pool p
        WHERE p.draft_id = ?
          AND NOT EXISTS (SELECT 1 FROM draft_picks k WHERE k.draft_id = ? AND k.player_id = p.player_id)${like}
        ORDER BY p.adp, p.player_id LIMIT ?`
    )
    .bind(...binds)
    .all();
  return (results ?? []).map(poolShape);
}

export async function poolPlayer(db, draftId, playerId) {
  const { results } = await db
    .prepare(`SELECT * FROM draft_pool WHERE draft_id = ? AND player_id = ?`)
    .bind(draftId, playerId)
    .all();
  return results?.[0] ? poolShape(results[0]) : null;
}

export async function draftPicks(db, draftId) {
  const { results } = await db
    .prepare(`SELECT * FROM draft_picks WHERE draft_id = ? ORDER BY pick_no`)
    .bind(draftId)
    .all();
  return (results ?? []).map(pickShape);
}

/**
 * Make the next pick and move the draft on, or say why not.
 *
 * The insert is the lock: a slot (and a player) can be filled only once, so a
 * pick that loses a race fails here and nothing else has changed. The advance
 * is conditional on the pick number still being the one this pick filled.
 */
export async function recordPick(db, draft, pick, { next, deadline, finished, now }) {
  try {
    await db
      .prepare(
        `INSERT INTO draft_picks (draft_id, pick_no, team_id, player_id, player_name, position, pro_team, auto, picked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(draft.id, draft.pickNo, pick.teamId, pick.player.id, pick.player.name, pick.player.position,
        pick.player.proTeam, pick.auto ? 1 : 0, now ?? new Date().toISOString())
      .run();
  } catch (err) {
    if (/UNIQUE|constraint/i.test(String(err.message))) return { ok: false, reason: 'taken' };
    throw err;
  }
  const res = await db
    .prepare(
      finished
        ? `UPDATE drafts SET pick_no = ?, deadline = NULL, status = 'done', finished_at = ? WHERE id = ? AND pick_no = ?`
        : `UPDATE drafts SET pick_no = ?, deadline = ? WHERE id = ? AND pick_no = ?`
    )
    .bind(...(finished ? [next, now ?? new Date().toISOString(), draft.id, draft.pickNo] : [next, deadline ?? null, draft.id, draft.pickNo]))
    .run();
  return { ok: (res?.meta?.changes ?? 0) > 0, reason: 'raced' };
}
