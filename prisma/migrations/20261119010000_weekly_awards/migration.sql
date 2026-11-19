-- Weekly awards of a team roster (src/lib/weeklyAwardsCore.ts):
--   RankSnapshot     rank readings per player and queue, one row per change
--                    (seenAt moves while the reading stays the same). The
--                    Grinder award reads the LP won over a week from here.
--   PlayerGameScore  MVP score of one player in one game (score null when the
--                    game does not count), recomputed when version changes.
--   TeamWeeklyAward  result of each award for each completed week of a team
--                    (memberId null when nobody qualified).
-- Local only, not synced: derived from Riot data on each device.
-- No semicolon in these comments: the migration runner splits on it.

CREATE TABLE "RankSnapshot" (
  "id"       TEXT NOT NULL PRIMARY KEY,
  "puuid"    TEXT NOT NULL,
  "queue"    TEXT NOT NULL,
  "tier"     TEXT NOT NULL,
  "division" TEXT,
  "lp"       INTEGER NOT NULL,
  "wins"     INTEGER NOT NULL,
  "losses"   INTEGER NOT NULL,
  "ladder"   INTEGER NOT NULL,
  "takenAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "seenAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "RankSnapshot_puuid_queue_takenAt_idx" ON "RankSnapshot"("puuid", "queue", "takenAt");

CREATE TABLE "PlayerGameScore" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "puuid"       TEXT NOT NULL,
  "matchId"     TEXT NOT NULL,
  "queueId"     INTEGER NOT NULL,
  "playedAt"    DATETIME NOT NULL,
  "durationSec" INTEGER NOT NULL,
  "role"        TEXT,
  "win"         BOOLEAN NOT NULL,
  "score"       REAL,
  "version"     INTEGER NOT NULL,
  "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "PlayerGameScore_puuid_matchId_key" ON "PlayerGameScore"("puuid", "matchId");
CREATE INDEX "PlayerGameScore_puuid_playedAt_idx" ON "PlayerGameScore"("puuid", "playedAt");

CREATE TABLE "TeamWeeklyAward" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "teamId"    TEXT NOT NULL,
  "kind"      TEXT NOT NULL,
  "weekKey"   TEXT NOT NULL,
  "weekStart" DATETIME NOT NULL,
  "memberId"  TEXT,
  "puuid"     TEXT,
  "value"     REAL,
  "games"     INTEGER,
  "raceJson"  TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamWeeklyAward_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TeamWeeklyAward_teamId_kind_weekKey_key" ON "TeamWeeklyAward"("teamId", "kind", "weekKey");
CREATE INDEX "TeamWeeklyAward_teamId_weekKey_idx" ON "TeamWeeklyAward"("teamId", "weekKey");
