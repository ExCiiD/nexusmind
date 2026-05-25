-- Custom games: user-imported scrim and tournament data (Replaybook CSV)

CREATE TABLE "CustomGame" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "teamId" TEXT NOT NULL,
  "gameType" TEXT NOT NULL,
  "gameDate" DATETIME,
  "durationSec" INTEGER NOT NULL,
  "win" BOOLEAN,
  "participantsJson" TEXT NOT NULL,
  "sourceFile" TEXT,
  "notes" TEXT,
  "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomGame_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CustomGame_teamId_idx" ON "CustomGame"("teamId");
CREATE INDEX "CustomGame_teamId_gameType_idx" ON "CustomGame"("teamId", "gameType");
