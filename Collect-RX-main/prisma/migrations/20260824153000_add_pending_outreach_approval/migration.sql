-- AlterTable
ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "pending_outreach_approval" BOOLEAN NOT NULL DEFAULT false;
