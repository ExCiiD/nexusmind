-- A local team can be the roster of a cloud group (Coaching & Management):
-- the group picked in the header then shows this team in Coaching (Espace
-- d'équipe, Champion Pool, Draft Sim, Scouting) and in Stats collectives.
-- One team per group, null for a team that belongs to no group.
-- No semicolon in these comments: the migration runner splits on it.

ALTER TABLE "Team" ADD COLUMN "groupId" TEXT;
CREATE INDEX "Team_groupId_idx" ON "Team"("groupId");
