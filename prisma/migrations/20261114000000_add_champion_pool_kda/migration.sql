-- Add kda column to ChampionPoolEntry. Average (kills+assists)/max(1,deaths)
-- aggregated for free from match participant data already fetched during
-- scout/auto-fill (no extra Riot calls). Feeds the "high win rate or KDA"
-- threat signal (src/lib/threatCore.ts), gated by a 20-game minimum so a
-- small sample can't fake a high KDA. Nullable for legacy/manual entries
-- and mastery-only entries with 0 games.
ALTER TABLE "ChampionPoolEntry" ADD COLUMN "kda" REAL;
