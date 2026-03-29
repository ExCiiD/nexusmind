-- CreateTable
CREATE TABLE "StatsSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "stats" TEXT NOT NULL,
    "gameCount" INTEGER NOT NULL,
    "firstGameAt" DATETIME NOT NULL,
    "lastGameAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "objectiveId" TEXT NOT NULL,
    "objectiveIds" TEXT NOT NULL DEFAULT '[]',
    "subObjective" TEXT,
    "customNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "aiSummary" TEXT,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Session" ("aiSummary", "customNote", "date", "id", "objectiveId", "status", "subObjective", "userId") SELECT "aiSummary", "customNote", "date", "id", "objectiveId", "status", "subObjective", "userId" FROM "Session";
DROP TABLE "Session";
ALTER TABLE "new_Session" RENAME TO "Session";
CREATE INDEX "Session_userId_status_idx" ON "Session"("userId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
