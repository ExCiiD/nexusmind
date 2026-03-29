-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "objectiveId" TEXT NOT NULL,
    "objectiveIds" TEXT NOT NULL DEFAULT '[]',
    "selectedKpiIds" TEXT NOT NULL DEFAULT '[]',
    "subObjective" TEXT,
    "customNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "aiSummary" TEXT,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Session" ("aiSummary", "customNote", "date", "id", "objectiveId", "objectiveIds", "status", "subObjective", "userId") SELECT "aiSummary", "customNote", "date", "id", "objectiveId", "objectiveIds", "status", "subObjective", "userId" FROM "Session";
DROP TABLE "Session";
ALTER TABLE "new_Session" RENAME TO "Session";
CREATE INDEX "Session_userId_status_idx" ON "Session"("userId", "status");
CREATE TABLE "new_User" (
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
    "queueFilter" TEXT NOT NULL DEFAULT 'both',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("assessmentFreqDays", "createdAt", "id", "lastActiveDate", "nextAssessmentAt", "puuid", "region", "streakDays", "summonerName", "tagLine", "updatedAt", "xp") SELECT "assessmentFreqDays", "createdAt", "id", "lastActiveDate", "nextAssessmentAt", "puuid", "region", "streakDays", "summonerName", "tagLine", "updatedAt", "xp" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_puuid_key" ON "User"("puuid");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
