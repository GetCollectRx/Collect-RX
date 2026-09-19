-- AlterTable
ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "privacy_policy_accepted_at" TIMESTAMP(3);
ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "privacy_policy_version" TEXT;
