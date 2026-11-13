-- Assistant (Phase A4): local 👍/👎 feedback on rule-based insights.
-- One row per (player, insight instance). Votes are tallied per rule to
-- adjust that player's rule weights (Beta prior / Thompson sampling).

CREATE TABLE "AssistantFeedback" (
  "id"         TEXT NOT NULL PRIMARY KEY,
  "userId"     TEXT NOT NULL,
  "ruleId"     TEXT NOT NULL,
  "insightKey" TEXT NOT NULL,
  "moment"     TEXT NOT NULL,
  "vote"       INTEGER NOT NULL,
  "createdAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  DATETIME NOT NULL,
  CONSTRAINT "AssistantFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AssistantFeedback_userId_insightKey_key" ON "AssistantFeedback"("userId", "insightKey");
CREATE INDEX "AssistantFeedback_userId_ruleId_idx" ON "AssistantFeedback"("userId", "ruleId");
