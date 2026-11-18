-- Settings → Recording, what Ascend's own window does around a recorded game:
--   recordInBackground  minimize Ascend and let Chromium throttle it while the
--                       game is recorded (the capture runs in its own window)
--   reviewPopup         bring Ascend to the front on the review page once the
--                       game, and its recording, are over
-- Both on by default: the first is what the recording settings already
-- promised, the second is what the app did at the end of every game.

ALTER TABLE "User" ADD COLUMN "recordInBackground" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "reviewPopup" BOOLEAN NOT NULL DEFAULT true;
