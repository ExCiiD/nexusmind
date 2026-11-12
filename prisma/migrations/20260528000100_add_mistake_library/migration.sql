-- Mistake Library: user-tagged moments in a recorded game ("dove tower",
-- "overstay", "late back"…) with frequency aggregation over time. Tags are
-- either built-in (seeded on first launch) or user-defined.

CREATE TABLE "MistakeTag" (
  "id"         TEXT PRIMARY KEY NOT NULL,
  "slug"       TEXT NOT NULL,
  "label"      TEXT NOT NULL,
  "category"   TEXT NOT NULL,
  "icon"       TEXT,
  "color"      TEXT,
  "isBuiltIn"  BOOLEAN NOT NULL DEFAULT false,
  "archivedAt" DATETIME,
  "createdAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "MistakeTag_slug_key" ON "MistakeTag"("slug");

CREATE TABLE "Mistake" (
  "id"           TEXT PRIMARY KEY NOT NULL,
  "gameId"       TEXT NOT NULL,
  "recordingId"  TEXT,
  "tagId"        TEXT NOT NULL,
  "gameTimeSec"  INTEGER NOT NULL,
  "videoTimeMs"  INTEGER,
  "note"         TEXT,
  "severity"     INTEGER NOT NULL DEFAULT 2,
  "autoDetected" BOOLEAN NOT NULL DEFAULT false,
  "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Mistake_gameId_fkey"      FOREIGN KEY ("gameId")      REFERENCES "Game"      ("id") ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT "Mistake_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Mistake_tagId_fkey"       FOREIGN KEY ("tagId")       REFERENCES "MistakeTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Mistake_gameId_idx"          ON "Mistake"("gameId");
CREATE INDEX "Mistake_tagId_createdAt_idx" ON "Mistake"("tagId", "createdAt");
