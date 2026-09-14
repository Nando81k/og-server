PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE games (
  id       TEXT PRIMARY KEY,
  season   INTEGER NOT NULL,
  week     INTEGER NOT NULL,
  kickoff  TEXT    NOT NULL,
  home     TEXT    NOT NULL,
  away     TEXT    NOT NULL,
  winner   TEXT,
  voided   INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "games" ("id","season","week","kickoff","home","away","winner","voided") VALUES('401872656',2026,1,'2026-09-10T00:20Z','SEA','NE',NULL,0);
INSERT INTO "games" ("id","season","week","kickoff","home","away","winner","voided") VALUES('401872657',2026,1,'2026-09-11T00:35Z','LAR','SF',NULL,0);
INSERT INTO "games" ("id","season","week","kickoff","home","away","winner","voided") VALUES('401872925',2026,1,'2026-09-13T17:00Z','CIN','TB',NULL,0);
INSERT INTO "games" ("id","season","week","kickoff","home","away","winner","voided") VALUES('401872923',2026,1,'2026-09-13T17:00Z','DET','NO',NULL,0);
INSERT INTO "games" ("id","season","week","kickoff","home","away","winner","voided") VALUES('401872924',2026,1,'2026-09-13T17:00Z','TEN','NYJ',NULL,0);
INSERT INTO "games" ("id","season","week","kickoff","home","away","winner","voided") VALUES('401872659',2026,1,'2026-09-13T17:00Z','IND','BAL',NULL,0);
INSERT INTO "games" ("id","season","week","kickoff","home","away","winner","voided") VALUES('401872658',2026,1,'2026-09-13T17:00Z','PIT','ATL',NULL,0);
INSERT INTO "games" ("id","season","week","kickoff","home","away","winner","voided") VALUES('401872661',2026,1,'2026-09-13T17:00Z','CAR','CHI',NULL,0);
INSERT INTO "games" ("id","season","week","kickoff","home","away","winner","voided") VALUES('401872922',2026,1,'2026-09-13T17:00Z','JAX','CLE',NULL,0);
INSERT INTO "games" ("id","season","week","kickoff","home","away","winner","voided") VALUES('401872660',2026,1,'2026-09-13T17:00Z','HOU','BUF',NULL,0);
INSERT INTO "games" ("id","season","week","kickoff","home","away","winner","voided") VALUES('401872928',2026,1,'2026-09-13T20:25Z','LV','MIA',NULL,0);
INSERT INTO "games" ("id","season","week","kickoff","home","away","winner","voided") VALUES('401872927',2026,1,'2026-09-13T20:25Z','MIN','GB',NULL,0);
INSERT INTO "games" ("id","season","week","kickoff","home","away","winner","voided") VALUES('401872929',2026,1,'2026-09-13T20:25Z','PHI','WSH',NULL,0);
INSERT INTO "games" ("id","season","week","kickoff","home","away","winner","voided") VALUES('401872926',2026,1,'2026-09-13T20:25Z','LAC','ARI',NULL,0);
INSERT INTO "games" ("id","season","week","kickoff","home","away","winner","voided") VALUES('401872930',2026,1,'2026-09-14T00:20Z','NYG','DAL',NULL,0);
INSERT INTO "games" ("id","season","week","kickoff","home","away","winner","voided") VALUES('401872931',2026,1,'2026-09-15T00:15Z','KC','DEN',NULL,0);
CREATE TABLE picks (
  user_id    TEXT    NOT NULL,
  game_id    TEXT    NOT NULL,
  season     INTEGER NOT NULL,
  week       INTEGER NOT NULL,
  team       TEXT    NOT NULL,
  confidence INTEGER NOT NULL,
  PRIMARY KEY (user_id, game_id)
);
INSERT INTO "picks" ("user_id","game_id","season","week","team","confidence") VALUES('285197606982778880','401872656',2026,1,'NE',16);
INSERT INTO "picks" ("user_id","game_id","season","week","team","confidence") VALUES('285197606982778880','401872657',2026,1,'SF',15);
INSERT INTO "picks" ("user_id","game_id","season","week","team","confidence") VALUES('285197606982778880','401872658',2026,1,'PIT',14);
INSERT INTO "picks" ("user_id","game_id","season","week","team","confidence") VALUES('285197606982778880','401872659',2026,1,'IND',13);
INSERT INTO "picks" ("user_id","game_id","season","week","team","confidence") VALUES('285197606982778880','401872660',2026,1,'HOU',12);
INSERT INTO "picks" ("user_id","game_id","season","week","team","confidence") VALUES('285197606982778880','401872661',2026,1,'CHI',11);
INSERT INTO "picks" ("user_id","game_id","season","week","team","confidence") VALUES('285197606982778880','401872922',2026,1,'CLE',10);
INSERT INTO "picks" ("user_id","game_id","season","week","team","confidence") VALUES('285197606982778880','401872923',2026,1,'NO',9);
INSERT INTO "picks" ("user_id","game_id","season","week","team","confidence") VALUES('285197606982778880','401872924',2026,1,'NYJ',8);
INSERT INTO "picks" ("user_id","game_id","season","week","team","confidence") VALUES('285197606982778880','401872925',2026,1,'CIN',7);
INSERT INTO "picks" ("user_id","game_id","season","week","team","confidence") VALUES('285197606982778880','401872926',2026,1,'ARI',6);
INSERT INTO "picks" ("user_id","game_id","season","week","team","confidence") VALUES('285197606982778880','401872927',2026,1,'GB',5);
INSERT INTO "picks" ("user_id","game_id","season","week","team","confidence") VALUES('285197606982778880','401872928',2026,1,'MIA',4);
INSERT INTO "picks" ("user_id","game_id","season","week","team","confidence") VALUES('285197606982778880','401872929',2026,1,'PHI',3);
INSERT INTO "picks" ("user_id","game_id","season","week","team","confidence") VALUES('285197606982778880','401872930',2026,1,'NYG',2);
INSERT INTO "picks" ("user_id","game_id","season","week","team","confidence") VALUES('285197606982778880','401872931',2026,1,'KC',1);
CREATE TABLE teams (
  abbr       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  short_name TEXT NOT NULL,
  logo       TEXT NOT NULL,
  color      TEXT NOT NULL,
  alt_color  TEXT NOT NULL
);
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('SEA','Seattle Seahawks','Seahawks','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/sea.png','002a5c','69be28');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('NE','New England Patriots','Patriots','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/ne.png','002a5c','c60c30');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('LAR','Los Angeles Rams','Rams','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/lar.png','003594','ffd100');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('SF','San Francisco 49ers','49ers','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/sf.png','aa0000','b3995d');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('CIN','Cincinnati Bengals','Bengals','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/cin.png','fb4f14','000000');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('TB','Tampa Bay Buccaneers','Buccaneers','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/tb.png','bd1c36','3e3a35');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('DET','Detroit Lions','Lions','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/det.png','0076b6','bbbbbb');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('NO','New Orleans Saints','Saints','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/no.png','d3bc8d','000000');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('TEN','Tennessee Titans','Titans','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/ten.png','4495d2','001532');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('NYJ','New York Jets','Jets','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/nyj.png','115740','ffffff');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('IND','Indianapolis Colts','Colts','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/ind.png','003b75','ffffff');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('BAL','Baltimore Ravens','Ravens','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/bal.png','29126f','000000');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('PIT','Pittsburgh Steelers','Steelers','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/pit.png','000000','ffb612');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('ATL','Atlanta Falcons','Falcons','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/atl.png','a71930','000000');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('CAR','Carolina Panthers','Panthers','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/car.png','0085ca','000000');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('CHI','Chicago Bears','Bears','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/chi.png','0b1c3a','e64100');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('JAX','Jacksonville Jaguars','Jaguars','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/jax.png','007487','d7a22a');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('CLE','Cleveland Browns','Browns','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/cle.png','472a08','ff3c00');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('HOU','Houston Texans','Texans','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/hou.png','021018','eb0028');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('BUF','Buffalo Bills','Bills','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/buf.png','00338d','d50a0a');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('LV','Las Vegas Raiders','Raiders','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/lv.png','000000','a5acaf');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('MIA','Miami Dolphins','Dolphins','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/mia.png','008e97','fc4c02');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('MIN','Minnesota Vikings','Vikings','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/min.png','4f2683','ffc62f');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('GB','Green Bay Packers','Packers','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/gb.png','204e32','ffb612');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('PHI','Philadelphia Eagles','Eagles','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/phi.png','06424d','000000');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('WSH','Washington Commanders','Commanders','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/wsh.png','5a1414','ffb612');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('LAC','Los Angeles Chargers','Chargers','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/lac.png','0080c6','ffc20e');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('ARI','Arizona Cardinals','Cardinals','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/ari.png','a40227','ffffff');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('NYG','New York Giants','Giants','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/nyg.png','003c7f','c9243f');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('DAL','Dallas Cowboys','Cowboys','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/dal.png','002a5c','b0b7bc');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('KC','Kansas City Chiefs','Chiefs','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/kc.png','e31837','ffb612');
INSERT INTO "teams" ("abbr","name","short_name","logo","color","alt_color") VALUES('DEN','Denver Broncos','Broncos','https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/den.png','0a2343','fc4c02');
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE points (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  season     INTEGER NOT NULL,
  user_id    TEXT    NOT NULL,
  amount     INTEGER NOT NULL,
  reason     TEXT    NOT NULL,
  awarded_by TEXT    NOT NULL,
  awarded_at TEXT    NOT NULL
);
CREATE TABLE tournaments (
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
CREATE TABLE tournament_entrants (
  tournament_id TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  joined_at     TEXT NOT NULL,
  PRIMARY KEY (tournament_id, user_id)
);
DELETE FROM sqlite_sequence;
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('points',1);
CREATE INDEX games_week ON games (season, week);
CREATE INDEX picks_week ON picks (season, week);
CREATE INDEX points_season ON points (season);
CREATE INDEX tournaments_open ON tournaments (season, status);
