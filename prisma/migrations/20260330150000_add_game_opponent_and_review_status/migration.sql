-- Add missing columns to Game table
ALTER TABLE "Game" ADD COLUMN "opponentChampion" TEXT;
ALTER TABLE "Game" ADD COLUMN "reviewStatus" TEXT NOT NULL DEFAULT 'pending';
