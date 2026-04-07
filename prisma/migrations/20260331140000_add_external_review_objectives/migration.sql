ALTER TABLE "ExternalReview" ADD COLUMN "objectiveIds"   TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "ExternalReview" ADD COLUMN "selectedKpiIds" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "ExternalReview" ADD COLUMN "kpiScores"      TEXT NOT NULL DEFAULT '{}';
