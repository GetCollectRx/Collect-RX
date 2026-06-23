-- Trial onboarding sequence fields on prospects
ALTER TABLE "prospects"
  ADD COLUMN IF NOT EXISTS "trial_started_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "trial_sequence_step" INTEGER NOT NULL DEFAULT 0;
