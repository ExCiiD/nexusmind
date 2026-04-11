-- Add sessionConclusion field to Session
-- This replaces the aiSummary field for user-written end-of-session reflections.
ALTER TABLE "Session" ADD COLUMN "sessionConclusion" TEXT;
