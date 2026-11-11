-- AlterTable
ALTER TABLE "cdcp_coverage" ADD COLUMN IF NOT EXISTS "has_provincial_secondary" BOOLEAN NOT NULL DEFAULT false;
