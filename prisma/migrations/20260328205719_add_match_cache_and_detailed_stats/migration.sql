-- CreateTable
CREATE TABLE "GameDetailedStats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT NOT NULL,
    "stats" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GameDetailedStats_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MatchCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matchId" TEXT NOT NULL,
    "matchJson" TEXT NOT NULL,
    "timelineJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "GameDetailedStats_gameId_key" ON "GameDetailedStats"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchCache_matchId_key" ON "MatchCache"("matchId");
