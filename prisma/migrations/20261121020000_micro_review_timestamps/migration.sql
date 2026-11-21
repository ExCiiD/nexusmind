-- 21/11/2026 (DECISIONS « Repères de la micro-review »).
-- Mistake.startSec and endSec: the window the player set with precise timestamps, error minus 5 s to consequence plus 5 s.
-- Null when not set: the Lab, the bookmarks and the playback keep their usual window around gameTimeSec.
-- MicroReviewAnswer.errorAtSec and consequenceAtSec: the timestamps as the player set them, to reopen the card with them.
ALTER TABLE "Mistake" ADD COLUMN "startSec" INTEGER;
ALTER TABLE "Mistake" ADD COLUMN "endSec" INTEGER;
ALTER TABLE "MicroReviewAnswer" ADD COLUMN "errorAtSec" INTEGER;
ALTER TABLE "MicroReviewAnswer" ADD COLUMN "consequenceAtSec" INTEGER;
