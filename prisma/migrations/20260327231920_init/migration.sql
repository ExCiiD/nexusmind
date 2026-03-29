-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "summonerName" TEXT NOT NULL,
    "puuid" TEXT NOT NULL,
    "tagLine" TEXT NOT NULL DEFAULT '',
    "region" TEXT NOT NULL,
    "assessmentFreqDays" INTEGER NOT NULL DEFAULT 14,
    "nextAssessmentAt" DATETIME NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "streakDays" INTEGER NOT NULL DEFAULT 0,
    "lastActiveDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Assessment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssessmentScore" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assessmentId" TEXT NOT NULL,
    "fundamentalId" TEXT NOT NULL,
    "subcategoryId" TEXT,
    "score" INTEGER NOT NULL,
    CONSTRAINT "AssessmentScore_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "objectiveId" TEXT NOT NULL,
    "subObjective" TEXT,
    "customNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "aiSummary" TEXT,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "champion" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "kills" INTEGER NOT NULL,
    "deaths" INTEGER NOT NULL,
    "assists" INTEGER NOT NULL,
    "cs" INTEGER NOT NULL,
    "visionScore" INTEGER NOT NULL,
    "duration" INTEGER NOT NULL,
    "win" BOOLEAN NOT NULL,
    "rank" TEXT,
    "lp" INTEGER,
    "gameEndAt" DATETIME NOT NULL,
    CONSTRAINT "Game_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT NOT NULL,
    "timelineNotes" TEXT NOT NULL,
    "kpiScores" TEXT NOT NULL,
    "freeText" TEXT,
    "aiSummary" TEXT,
    "objectiveRespected" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Review_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Badge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "badgeId" TEXT NOT NULL,
    "unlockedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Badge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_puuid_key" ON "User"("puuid");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentScore_assessmentId_fundamentalId_subcategoryId_key" ON "AssessmentScore"("assessmentId", "fundamentalId", "subcategoryId");

-- CreateIndex
CREATE INDEX "Session_userId_status_idx" ON "Session"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Game_matchId_key" ON "Game"("matchId");

-- CreateIndex
CREATE INDEX "Game_sessionId_idx" ON "Game"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_gameId_key" ON "Review"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "Badge_userId_badgeId_key" ON "Badge"("userId", "badgeId");
