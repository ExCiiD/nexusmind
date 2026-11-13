-- Coaching engine (lot 2): experiments (closed loop). One active per player.

CREATE TABLE "CoachingExperiment" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "userId"        TEXT NOT NULL,
  "problemId"     TEXT NOT NULL,
  "fundamentalId" TEXT,
  "ruleId"        TEXT,
  "tagSlug"       TEXT,
  "criterion"     TEXT NOT NULL,
  "baseline"      TEXT NOT NULL,
  "windowGames"   INTEGER NOT NULL DEFAULT 5,
  "source"        TEXT NOT NULL DEFAULT 'assistant',
  "status"        TEXT NOT NULL DEFAULT 'active',
  "verdict"       TEXT,
  "passRate"      REAL,
  "results"       TEXT,
  "startedAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt"       DATETIME,
  "updatedAt"     DATETIME NOT NULL,
  CONSTRAINT "CoachingExperiment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CoachingExperiment_userId_status_idx" ON "CoachingExperiment"("userId", "status");
