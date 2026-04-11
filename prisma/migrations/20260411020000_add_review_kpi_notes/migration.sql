-- Add kpiNotes field to Review (JSON map of kpiId → free-text note)
ALTER TABLE "Review" ADD COLUMN "kpiNotes" TEXT;
