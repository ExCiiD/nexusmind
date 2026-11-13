-- MX3: learned severity threshold per (player, mistake tag).

CREATE TABLE "MistakeTagTuning" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "userId"        TEXT NOT NULL,
  "tagId"         TEXT NOT NULL,
  "deletedCount"  INTEGER NOT NULL DEFAULT 0,
  "severityDelta" INTEGER NOT NULL DEFAULT 0,
  "updatedAt"     DATETIME NOT NULL,
  CONSTRAINT "MistakeTagTuning_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MistakeTagTuning_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "MistakeTag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MistakeTagTuning_userId_tagId_key" ON "MistakeTagTuning"("userId", "tagId");
