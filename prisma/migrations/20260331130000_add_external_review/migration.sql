CREATE TABLE IF NOT EXISTS "ExternalReview" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "userId"        TEXT NOT NULL,
  "title"         TEXT NOT NULL,
  "objectiveId"   TEXT,
  "timelineNotes" TEXT NOT NULL DEFAULT '[]',
  "freeText"      TEXT,
  "filePath"      TEXT,
  "playerName"    TEXT,
  "matchData"     TEXT,
  "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "ExternalReview_userId_idx" ON "ExternalReview"("userId");
