-- Replace partial unique index with a full unique index on Recording.gameId.
-- SQLite treats NULLs as distinct in unique indexes, so multiple orphaned
-- recordings (gameId = NULL) are still allowed.
-- The partial index (WHERE "gameId" IS NOT NULL) caused Prisma's upsert to
-- fail: "ON CONFLICT clause does not match any UNIQUE constraint".

DROP INDEX IF EXISTS "Recording_gameId_key";
CREATE UNIQUE INDEX "Recording_gameId_key" ON "Recording"("gameId");
