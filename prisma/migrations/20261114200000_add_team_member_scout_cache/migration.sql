-- E15: incremental scout/auto-fill. Persists the season match-id list as
-- of the last scout per TeamMember, so a repeat scout only asks Riot for
-- games played after `lastScoutedAt` instead of re-listing the whole
-- season (up to ~25 paginated calls) every time. Nullable — absent means
-- "never scouted", which falls back to a full relist.
ALTER TABLE "TeamMember" ADD COLUMN "lastScoutedAt" DATETIME;
ALTER TABLE "TeamMember" ADD COLUMN "seasonMatchIdsJson" TEXT;
