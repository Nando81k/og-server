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
