-- Lane Phase Comparator: JSON-encoded LanePhaseReport cached on the Game row.
-- Computed lazily by stats:get-lane-phase from the cached MatchCache.timelineJson.
ALTER TABLE "Game" ADD COLUMN "lanePhaseReport" TEXT;
