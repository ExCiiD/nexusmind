-- Recreate Recording table with nullable gameId to support orphaned recordings
-- (recordings from external folders not matched to any game)

CREATE TABLE "Recording_v2" (
  "id"            TEXT     NOT NULL PRIMARY KEY,
  "gameId"        TEXT,
  "filePath"      TEXT,
  "youtubeUrl"    TEXT,
  "source"        TEXT     NOT NULL DEFAULT 'manual',
  "duration"      INTEGER,
  "thumbnailPath" TEXT,
  "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "Recording_v2" ("id","gameId","filePath","youtubeUrl","source","duration","thumbnailPath","createdAt")
SELECT "id","gameId","filePath","youtubeUrl","source","duration","thumbnailPath","createdAt" FROM "Recording";

DROP TABLE "Recording";

ALTER TABLE "Recording_v2" RENAME TO "Recording";

-- Partial unique index: gameId must be unique when non-null, but multiple NULLs are allowed
CREATE UNIQUE INDEX IF NOT EXISTS "Recording_gameId_key" ON "Recording"("gameId") WHERE "gameId" IS NOT NULL;
