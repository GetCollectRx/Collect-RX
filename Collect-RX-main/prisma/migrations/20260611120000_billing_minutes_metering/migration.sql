-- Minutes-based billing (src/billing/tiers.ts) — additive only.
--
-- Adds the schema needed for the trial/core/growth/scale minutes-metered
-- model alongside the existing Plan/UsageEvent (outcome-gated) model.
-- Plan and UsageEvent are NOT dropped or modified by this migration —
-- see tasks/lessons.md for the cutover plan. planBridge.ts and the
-- src/services/plans/*.cjs services continue to read Plan/UsageEvent
-- until that cutover lands; this migration only adds new, unused-so-far
-- columns/tables so the cutover can be a code-only change.
--
-- Idempotent: safe when enums/tables/columns already exist.

DO $$ BEGIN
  CREATE TYPE "BillingTier" AS ENUM ('trial', 'core', 'growth', 'scale');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Extend Practice ───────────────────────────────────────────────────────
-- subscriptionCurrentPeriodEnd (added 20260509120000) already covers
-- billing_period_end — only billingPeriodStart is new.

ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "billingTier" "BillingTier" NOT NULL DEFAULT 'trial';
ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "stripeSubscriptionItemId" TEXT;
ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "billingPeriodStart" TIMESTAMP(3);
ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "trialEndsAt" TIMESTAMP(3);
ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "callsPaused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "callsPausedReason" TEXT;
ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "callsPausedAt" TIMESTAMP(3);
ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "overageConfirmed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "overageConfirmedAt" TIMESTAMP(3);

-- Existing practices get a 30-day trial window starting now.
UPDATE "Practice" SET "trialEndsAt" = NOW() + INTERVAL '30 days' WHERE "trialEndsAt" IS NULL;

-- ─── Extend call_attempts ──────────────────────────────────────────────────

ALTER TABLE "call_attempts" ADD COLUMN IF NOT EXISTS "minutes_billed" INTEGER;

-- ─── usage_periods ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "usage_periods" (
    "id"                 TEXT NOT NULL,
    "practice_id"        TEXT NOT NULL,
    "period_start"       TIMESTAMP(3) NOT NULL,
    "period_end"         TIMESTAMP(3) NOT NULL,
    "minutes_consumed"   INTEGER NOT NULL DEFAULT 0,
    "calls_completed"    INTEGER NOT NULL DEFAULT 0,
    "warning_80_sent"    BOOLEAN NOT NULL DEFAULT false,
    "warning_reset_sent" BOOLEAN NOT NULL DEFAULT false,
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usage_periods_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "usage_periods_practice_id_idx" ON "usage_periods"("practice_id");
CREATE INDEX IF NOT EXISTS "usage_periods_period_start_period_end_idx" ON "usage_periods"("period_start", "period_end");

DO $$ BEGIN
  ALTER TABLE "usage_periods" ADD CONSTRAINT "usage_periods_practice_id_fkey"
    FOREIGN KEY ("practice_id") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── feature_flags ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "feature_flags" (
    "id"                                   TEXT NOT NULL,
    "practice_id"                         TEXT,
    "feature"                              TEXT NOT NULL,
    "paused"                               BOOLEAN NOT NULL DEFAULT false,
    "pause_reason"                         TEXT,
    "paused_at"                            TIMESTAMP(3),
    "resume_requires_manual_confirmation"  BOOLEAN NOT NULL DEFAULT true,
    "created_at"                           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                           TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "feature_flags_practice_id_feature_key" ON "feature_flags"("practice_id", "feature");

DO $$ BEGIN
  ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_practice_id_fkey"
    FOREIGN KEY ("practice_id") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
