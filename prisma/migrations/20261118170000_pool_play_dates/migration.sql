-- Champion pool tiers v2 (src/lib/threatCore.ts):
--   firstPlayedAt / lastPlayedAt  first and last analysed game on the champion
--                                 in this role. They give the "new" tier
--                                 (picked up less than two weeks ago) and the
--                                 drop of a main left aside for 30 days.
--   autoTier                      the tier the rule computed last time. A tier
--                                 that differs from it was chosen by hand and
--                                 is kept.
-- All nullable: existing entries are re-tiered once at start-up
-- (refreshAutoTiers in electron/main/ipc/team.ipc.ts), without dates until
-- the next auto-fill or scout.
-- No semicolon in these comments: the migration runner splits on it.

ALTER TABLE "ChampionPoolEntry" ADD COLUMN "firstPlayedAt" DATETIME;
ALTER TABLE "ChampionPoolEntry" ADD COLUMN "lastPlayedAt" DATETIME;
ALTER TABLE "ChampionPoolEntry" ADD COLUMN "autoTier" TEXT;
