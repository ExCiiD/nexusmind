-- Players a user has chosen to compare their "fundamentals radar" against
-- (Dashboard), identified by their resolved puuid rather than their Riot ID
-- so a later name change by the tracked player never breaks the comparison.

CREATE TABLE "FollowedPlayer" (
  "id"         TEXT NOT NULL PRIMARY KEY,
  "userId"     TEXT NOT NULL,
  "gameName"   TEXT NOT NULL,
  "tagLine"    TEXT NOT NULL,
  "region"     TEXT NOT NULL,
  "puuid"      TEXT NOT NULL,
  "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "FollowedPlayer_userId_puuid_key" ON "FollowedPlayer"("userId", "puuid");
CREATE INDEX "FollowedPlayer_userId_idx" ON "FollowedPlayer"("userId");
