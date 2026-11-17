-- Micro-review, follow-up (docs/PLAN_MICRO_REVIEW.md).
--   MicroReviewAnswer.mistakeOrigin  how the answer's Mistake row came to be:
--     created        the answer created it (re-answering deletes it)
--     confirmed-auto it confirmed an auto-detected one (re-answering un-confirms it)
--     existing       it reused a mistake the player had already tagged (never touched)
--   GameAnalysis.reviewXpAwarded     XP for completing the micro-review is granted once
--     per game, even when the analysis is recomputed with new moments.

ALTER TABLE "MicroReviewAnswer" ADD COLUMN "mistakeOrigin" TEXT;
ALTER TABLE "GameAnalysis" ADD COLUMN "reviewXpAwarded" BOOLEAN NOT NULL DEFAULT false;

-- Reviews answered before the flag existed were paid under the previous rule
-- (XP on the last answer): never pay them a second time. Both micro-review
-- migrations ship in the same release, so this only touches databases that
-- ran a pre-release build.
UPDATE "GameAnalysis" SET "reviewXpAwarded" = true WHERE "gameId" IN (SELECT "gameId" FROM "MicroReviewAnswer");
