-- 20/11/2026: the server of each Riot account. regionMode is 'auto' (found from the puuid) or a platform the
-- player chose, which wins. previousRegion is the server the account played on before a transfer, where its
-- older games stay.
ALTER TABLE "User" ADD COLUMN "regionMode" TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE "User" ADD COLUMN "previousRegion" TEXT;
ALTER TABLE "Account" ADD COLUMN "regionMode" TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE "Account" ADD COLUMN "previousRegion" TEXT;
