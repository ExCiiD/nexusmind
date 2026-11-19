-- #38 (19/11/2026): the Riot ID a team member had before a rename, shown to the staff
ALTER TABLE "TeamMember" ADD COLUMN "previousRiotId" TEXT;
