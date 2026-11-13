-- Coaching engine (lot 1): one row per (player, problem, day) the assistant
-- put that problem forward. Used to avoid repeating the same advice day after
-- day without new evidence.

CREATE TABLE "AdviceLog" (
  "id"         TEXT NOT NULL PRIMARY KEY,
  "userId"     TEXT NOT NULL,
  "problemId"  TEXT NOT NULL,
  "insightKey" TEXT NOT NULL,
  "moment"     TEXT NOT NULL,
  "day"        TEXT NOT NULL,
  "shownAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  DATETIME NOT NULL,
  CONSTRAINT "AdviceLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AdviceLog_userId_problemId_day_key" ON "AdviceLog"("userId", "problemId", "day");
CREATE INDEX "AdviceLog_userId_shownAt_idx" ON "AdviceLog"("userId", "shownAt");
