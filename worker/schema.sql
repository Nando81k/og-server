-- worker/schema.sql
CREATE TABLE IF NOT EXISTS games (
  id       TEXT PRIMARY KEY,
  season   INTEGER NOT NULL,
  week     INTEGER NOT NULL,
  kickoff  TEXT    NOT NULL,
  home     TEXT    NOT NULL,
  away     TEXT    NOT NULL,
  winner   TEXT,
  voided   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS games_week ON games (season, week);

CREATE TABLE IF NOT EXISTS picks (
  user_id    TEXT    NOT NULL,
  game_id    TEXT    NOT NULL,
  season     INTEGER NOT NULL,
  week       INTEGER NOT NULL,
  team       TEXT    NOT NULL,
  confidence INTEGER NOT NULL,
  PRIMARY KEY (user_id, game_id)
);
CREATE INDEX IF NOT EXISTS picks_week ON picks (season, week);

-- Branding for the pick form, captured from the same ESPN payload the schedule
-- sync reads. Keyed by abbreviation because that is what games rows store.
CREATE TABLE IF NOT EXISTS teams (
  abbr       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  short_name TEXT NOT NULL,
  logo       TEXT NOT NULL,
  color      TEXT NOT NULL,
  alt_color  TEXT NOT NULL
);

-- What the weekly job has already done, so a step that succeeded is never
-- repeated and a step that failed is never skipped. The scoring job used to
-- rely on the games table alone: writing a week's winners is what advances
-- openWeek, so once that write landed the week could never be reconsidered,
-- and a Discord outage between the write and the post lost the post forever.
-- Keys: "posted:<season>:<week>" and "announced:<season>".
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Points awarded by hand, for everything the pick'em cannot score itself:
-- tournament placements, meme of the week, aux battles, fantasy finishes.
--
-- An append-only ledger, not a running total per person. Two awards to the
-- same player are ordinary, a correction is a second row with a negative
-- amount, and nothing is ever overwritten — so the leaderboard can always be
-- explained by reading the rows that built it.
CREATE TABLE IF NOT EXISTS points (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  season     INTEGER NOT NULL,
  user_id    TEXT    NOT NULL,
  amount     INTEGER NOT NULL,
  reason     TEXT    NOT NULL,
  awarded_by TEXT    NOT NULL,
  awarded_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS points_season ON points (season);

-- Tournaments, stored as the draw plus the results — never as the bracket.
--
-- `seeds` is the entrant order fixed at the moment the bracket is drawn, and
-- `results` is an ordered list of {match, winner}. The bracket engine is pure
-- and createBracket is deterministic, so replaying those two rebuilds the
-- exact same bracket every time. Storing it this way is what makes a mod undo
-- correct: drop the last result and replay, instead of trying to reverse a
-- cascade back through the losers bracket and the grand final by hand.
--
-- status: 'signup' | 'running' | 'done' | 'cancelled'
CREATE TABLE IF NOT EXISTS tournaments (
  id         TEXT PRIMARY KEY,
  season     INTEGER NOT NULL,
  name       TEXT    NOT NULL,
  status     TEXT    NOT NULL,
  seeds      TEXT,
  results    TEXT    NOT NULL DEFAULT '[]',
  channel_id TEXT,
  created_by TEXT    NOT NULL,
  created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS tournaments_open ON tournaments (season, status);

-- Display names are captured at sign-up rather than fetched when needed.
-- Autocomplete gets about three seconds for the whole interaction, and
-- resolving sixteen matches would mean up to thirty-two member lookups.
CREATE TABLE IF NOT EXISTS tournament_entrants (
  tournament_id TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  joined_at     TEXT NOT NULL,
  PRIMARY KEY (tournament_id, user_id)
);

-- Which ESPN team belongs to which Discord user, so the bot knows whose trade a
-- proposal is and who may not vote on it. Claimed by the user (/fantasy link),
-- not verified against ESPN: this is a friend group, and a mod can reassign.
-- One team per user per season, and one user per team.
CREATE TABLE IF NOT EXISTS fantasy_links (
  user_id   TEXT    NOT NULL,
  season    INTEGER NOT NULL,
  team_id   INTEGER NOT NULL,
  team_name TEXT    NOT NULL,
  linked_at TEXT    NOT NULL,
  PRIMARY KEY (user_id, season)
);
CREATE UNIQUE INDEX IF NOT EXISTS fantasy_links_team ON fantasy_links (season, team_id);

-- Trade proposals voted on in Discord. `give` and `get` are JSON lists of
-- {id, name} from the proposer's point of view, with names captured now so the
-- card never needs ESPN to render.
--
-- status: 'open' | 'approved' | 'flagged' | 'no_quorum'   (voting finished)
--         'vetoed' | 'cancelled' | 'completed'            (final)
-- The bot only reports; it cannot stop or make a trade in ESPN.
CREATE TABLE IF NOT EXISTS trades (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  season      INTEGER NOT NULL,
  proposer_id TEXT    NOT NULL,
  from_team   INTEGER NOT NULL,
  to_team     INTEGER NOT NULL,
  from_name   TEXT    NOT NULL,
  to_name     TEXT    NOT NULL,
  give        TEXT    NOT NULL,
  get         TEXT    NOT NULL,
  note        TEXT,
  status      TEXT    NOT NULL,
  channel_id  TEXT,
  message_id  TEXT,
  created_at  TEXT    NOT NULL,
  closes_at   TEXT    NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS trades_status ON trades (season, status);

-- One row per voter per trade: voting again changes the vote, not the count.
CREATE TABLE IF NOT EXISTS trade_votes (
  trade_id INTEGER NOT NULL,
  user_id  TEXT    NOT NULL,
  vote     TEXT    NOT NULL,
  voted_at TEXT    NOT NULL,
  PRIMARY KEY (trade_id, user_id)
);
