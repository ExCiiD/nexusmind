-- 20/11/2026: match ids the start-up catch-up must not import (electron/main/ignoredMatches.ts).
-- reason 'deleted': the player deleted that game, it never comes back on its own.
-- reason 'not_found': Riot has no such match (practice tool), asked again after a day at most.
CREATE TABLE IF NOT EXISTS "IgnoredMatch" (
    "matchId" TEXT NOT NULL PRIMARY KEY,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
