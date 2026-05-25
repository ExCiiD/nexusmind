-- Recording start offset: seconds between in-game start (gameEndAt - duration)
-- and when the file started being written (file birthtime). Lets the player
-- align timeline event markers (kills, dragons, etc) with the video playback.
ALTER TABLE "Recording" ADD COLUMN "startOffsetSec" REAL;
