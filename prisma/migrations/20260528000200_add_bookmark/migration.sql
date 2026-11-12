-- Bookmarks: free-form per-recording markers (no tag, no game-time anchor).
-- Lighter than a Mistake — works on orphan recordings without a linked Game.

CREATE TABLE "Bookmark" (
  "id"          TEXT PRIMARY KEY NOT NULL,
  "recordingId" TEXT NOT NULL,
  "videoTimeMs" INTEGER NOT NULL,
  "label"       TEXT,
  "color"       TEXT,
  "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Bookmark_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Bookmark_recordingId_idx" ON "Bookmark"("recordingId");
