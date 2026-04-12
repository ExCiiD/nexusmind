-- Game: queue type and session eligibility
ALTER TABLE "Game" ADD COLUMN "queueType" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "Game" ADD COLUMN "isSessionEligible" INTEGER NOT NULL DEFAULT 1;

-- Recording: thumbnail path
ALTER TABLE "Recording" ADD COLUMN "thumbnailPath" TEXT;

-- User: recording scope settings
ALTER TABLE "User" ADD COLUMN "recordScope" TEXT NOT NULL DEFAULT 'ranked_only';
ALTER TABLE "User" ADD COLUMN "recordAllowCustom" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "allowDesktopFallback" INTEGER NOT NULL DEFAULT 1;

-- Clip: new table for short video segments cut from recordings
CREATE TABLE IF NOT EXISTS "Clip" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "recordingId" TEXT NOT NULL,
  "filePath" TEXT NOT NULL,
  "thumbnailPath" TEXT,
  "title" TEXT,
  "startMs" INTEGER NOT NULL,
  "endMs" INTEGER NOT NULL,
  "linkedNoteText" TEXT,
  "youtubeUrl" TEXT,
  "tempShareUrl" TEXT,
  "tempShareExpiry" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Clip_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Clip_recordingId_idx" ON "Clip"("recordingId")
