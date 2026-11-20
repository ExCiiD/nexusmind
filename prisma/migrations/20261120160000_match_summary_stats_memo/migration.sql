-- AUDIT_PERF_2 (20/11/2026), local only, never synced.
-- MatchSummary (gain 7): what the History and the Dashboard show of one match for one of the player's accounts,
-- stored when the match is written, so stats:match-history no longer parses 50 match bodies of about 75 KB.
-- DetailedStatsMemo (gain 1): the detailed stats of a match for a player, kept across restarts. version is the
-- formula's version: a row of another version is computed again.
CREATE TABLE IF NOT EXISTS "MatchSummary" (
    "matchId" TEXT NOT NULL,
    "puuid" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "gameEndAt" DATETIME,
    "statsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("matchId", "puuid")
);
CREATE TABLE IF NOT EXISTS "DetailedStatsMemo" (
    "matchId" TEXT NOT NULL,
    "puuid" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "statsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("matchId", "puuid")
);
