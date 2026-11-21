-- 21/11/2026 (DECISIONS 20/11 and 21/11).
-- Session.customObjectives: objectives written by the player or assigned by the coach, JSON. A session may now have
-- no fundamental (objectiveId empty, objectiveIds empty) when it has at least one of these.
-- Review.customObjectiveResults: yes / no / partial and an optional note per written objective, JSON.
-- MicroReviewAnswer.extraMistakeIds and bookmarkId: what an answer added (extra tags, its bookmark), undone on re-answer.
-- User.selfReview and User.selfTagMistakes: I do my reviews myself, I tag my mistakes myself.
-- IgnoredMistake: auto-detected mistakes the player deleted, so the detection does not create them again.
ALTER TABLE "Session" ADD COLUMN "customObjectives" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Review" ADD COLUMN "customObjectiveResults" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "MicroReviewAnswer" ADD COLUMN "extraMistakeIds" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "MicroReviewAnswer" ADD COLUMN "bookmarkId" TEXT;
ALTER TABLE "User" ADD COLUMN "selfReview" BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "selfTagMistakes" BOOLEAN NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS "IgnoredMistake" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT NOT NULL,
    "tagSlug" TEXT NOT NULL,
    "gameTimeSec" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "IgnoredMistake_gameId_idx" ON "IgnoredMistake"("gameId");
-- MistakeCorrection (layer 1 of "the engine learns from corrections", 21/11/2026): every removal or retag of an
-- auto-detected mistake, with the rule's tag, the optional reason, and the context. Local only, never uploaded.
CREATE TABLE IF NOT EXISTS "MistakeCorrection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mistakeId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "ruleTag" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "newTag" TEXT,
    "reason" TEXT,
    "note" TEXT,
    "analysisVersion" INTEGER NOT NULL,
    "role" TEXT,
    "queueType" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "MistakeCorrection_ruleTag_idx" ON "MistakeCorrection"("ruleTag");
-- UserPreference (21/11/2026): a player's settings that follow them on every device (synced like the other tables),
-- one row per user and key, the value a validated JSON. First key: reviewPlayerFilters, the video player filters.
CREATE TABLE IF NOT EXISTS "UserPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "UserPreference_userId_key_key" ON "UserPreference"("userId", "key");
