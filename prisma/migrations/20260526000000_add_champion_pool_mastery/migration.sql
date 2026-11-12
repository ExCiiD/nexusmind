-- Add masteryPoints column to ChampionPoolEntry so the Draft Sim can
-- surface high-mastery threats (300k+ orange ring, dominant-most-played
-- red ring) without making a fresh Riot mastery call on every render.
-- Nullable to preserve compatibility with legacy entries created before
-- this column existed and manual entries that never went through auto-fill.
ALTER TABLE "ChampionPoolEntry" ADD COLUMN "masteryPoints" INTEGER;
