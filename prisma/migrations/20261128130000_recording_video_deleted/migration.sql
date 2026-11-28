-- 28/11/2026 (video retention, docs/design/RETENTION_VIDEO.md): when the retention purge deleted the video file.
-- The recording row stays (game, notes, mistakes, bookmarks, clips keep their link), only its file is gone.
-- Machine-local like filePath: not synced, emptied on backup import.
ALTER TABLE "Recording" ADD COLUMN "videoDeletedAt" DATETIME;
