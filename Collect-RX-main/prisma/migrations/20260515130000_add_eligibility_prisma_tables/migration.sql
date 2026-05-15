-- Phase 3 eligibility tables: Prisma models exist; prior migrations only ALTER if table present.
-- Idempotent: safe when enums/tables already exist.

DO $$ BEGIN
  CREATE TYPE "eligibility_status" AS ENUM ('active', 'inactive', 'unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "coverage_tier" AS ENUM ('preventive', 'basic', 'major', 'ortho');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "reconciliation_flag" AS ENUM ('within_threshold', 'variance_high', 'variance_critical', 'needs_review');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "insurance_plans" (
    "plan_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "carrier" "carrier_id" NOT NULL,
    "plan_name" TEXT NOT NULL,
    "group_number" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "effective_date" DATE NOT NULL,
    "termination_date" DATE,
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "telus_underlying_tpa" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "insurance_plans_pkey" PRIMARY KEY ("plan_id")
);

CREATE TABLE IF NOT EXISTS "eligibility_snapshots" (
    "snapshot_id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "carrier" "carrier_id" NOT NULL,
    "plan_id" TEXT,
    "status" "eligibility_status" NOT NULL DEFAULT 'unknown',
    "verified_at" TIMESTAMP(3) NOT NULL,
    "deductible_individual_met" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "deductible_family_met" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "annual_max_used_individual" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "annual_max_used_family" DECIMAL(10,2),
    "plan_year_start" DATE NOT NULL,
    "raw_carrier_response" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "eligibility_snapshots_pkey" PRIMARY KEY ("snapshot_id")
);

CREATE TABLE IF NOT EXISTS "reconciliation_logs" (
    "reconciliation_id" TEXT NOT NULL,
    "claim_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "estimate_id" TEXT,
    "reconciled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estimated_patient_total" DECIMAL(10,2) NOT NULL,
    "actual_patient_total" DECIMAL(10,2) NOT NULL,
    "variance" DECIMAL(10,2) NOT NULL,
    "variance_percent" DECIMAL(6,2) NOT NULL,
    "flag" "reconciliation_flag" NOT NULL,
    "patient_balance_adjustment" DECIMAL(10,2) NOT NULL,
    "variance_reasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "requires_human_review" BOOLEAN NOT NULL DEFAULT false,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_notes" TEXT,
    "raw_adjudication_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reconciliation_logs_pkey" PRIMARY KEY ("reconciliation_id")
);

DO $$ BEGIN
  ALTER TABLE "eligibility_snapshots" ADD CONSTRAINT "eligibility_snapshots_practice_id_fkey"
    FOREIGN KEY ("practice_id") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "insurance_plans_patient_id_idx" ON "insurance_plans"("patient_id");
CREATE INDEX IF NOT EXISTS "insurance_plans_carrier_idx" ON "insurance_plans"("carrier");

CREATE INDEX IF NOT EXISTS "eligibility_snapshots_practice_id_patient_id_carrier_verified_at_idx"
  ON "eligibility_snapshots"("practice_id", "patient_id", "carrier", "verified_at" DESC);

CREATE INDEX IF NOT EXISTS "reconciliation_logs_patient_id_reconciled_at_idx" ON "reconciliation_logs"("patient_id", "reconciled_at" DESC);
CREATE INDEX IF NOT EXISTS "reconciliation_logs_claim_id_idx" ON "reconciliation_logs"("claim_id");
