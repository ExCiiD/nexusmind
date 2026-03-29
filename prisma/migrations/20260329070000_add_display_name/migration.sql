-- AlterTable: add displayName column to existing User tables (missing from prior migrations)
ALTER TABLE "User" ADD COLUMN "displayName" TEXT NOT NULL DEFAULT '';
