-- Micro-review (docs/PLAN_MICRO_REVIEW.md): cached game analysis, QCM
-- answers (local learning) and calibration flashes. Local only, not synced.

CREATE TABLE "GameAnalysis" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "gameId"    TEXT NOT NULL,
  "version"   INTEGER NOT NULL,
  "payload"   TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "GameAnalysis_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GameAnalysis_gameId_key" ON "GameAnalysis"("gameId");

CREATE TABLE "MicroReviewAnswer" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "userId"      TEXT NOT NULL,
  "gameId"      TEXT NOT NULL,
  "momentKey"   TEXT NOT NULL,
  "trigger"     TEXT NOT NULL,
  "gameTimeSec" INTEGER NOT NULL,
  "outcome"     TEXT NOT NULL,
  "tagSlug"     TEXT,
  "reason"      TEXT,
  "viaOther"    BOOLEAN NOT NULL DEFAULT false,
  "note"        TEXT,
  "role"        TEXT NOT NULL,
  "champion"    TEXT NOT NULL,
  "mistakeId"   TEXT,
  "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   DATETIME NOT NULL,
  CONSTRAINT "MicroReviewAnswer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MicroReviewAnswer_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MicroReviewAnswer_gameId_momentKey_key" ON "MicroReviewAnswer"("gameId", "momentKey");
CREATE INDEX "MicroReviewAnswer_userId_role_idx" ON "MicroReviewAnswer"("userId", "role");

CREATE TABLE "CalibrationFlash" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "userId"      TEXT NOT NULL,
  "perceived"   TEXT NOT NULL,
  "measuredTop" TEXT,
  "gapPts"      INTEGER NOT NULL,
  "evidence"    INTEGER NOT NULL,
  "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CalibrationFlash_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CalibrationFlash_userId_createdAt_idx" ON "CalibrationFlash"("userId", "createdAt");
