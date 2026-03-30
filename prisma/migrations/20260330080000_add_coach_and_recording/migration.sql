-- Add coach/student role fields to User
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'student';
ALTER TABLE "User" ADD COLUMN "supabaseUid" TEXT;
ALTER TABLE "User" ADD COLUMN "supabaseEmail" TEXT;

-- Add Recording table
CREATE TABLE "Recording" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT NOT NULL,
    "filePath" TEXT,
    "youtubeUrl" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "duration" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Recording_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Recording_gameId_key" ON "Recording"("gameId");
