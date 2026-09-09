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
