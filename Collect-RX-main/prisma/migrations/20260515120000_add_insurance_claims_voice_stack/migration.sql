-- Phase 5 voice / claims stack: enums + core tables were never created by an earlier migration
-- (schema.prisma had models; DB only had older tables). Safe to re-run: IF NOT EXISTS guards.

-- ─── Enums (PostgreSQL has no CREATE TYPE IF NOT EXISTS) ───────────────────
DO $$ BEGIN
  CREATE TYPE "carrier_id" AS ENUM ('sun_life', 'canada_life', 'manulife', 'green_shield', 'rbc', 'telus_adjudicare');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "claim_status" AS ENUM ('PENDING', 'IN_QUEUE', 'CALLING', 'APPROVED_PENDING_PAYMENT', 'RESOLVED', 'DENIED', 'ESCALATED', 'ON_HOLD', 'BLOCKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "claim_priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "call_outcome" AS ENUM ('RESOLVED', 'PENDING', 'DENIED', 'ESCALATED', 'BLOCK_DETECTED', 'FAILED', 'NO_ANSWER', 'HUNG_UP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "queue_status" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'ESCALATED', 'BLOCKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Tables ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "insurance_claims" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "carrier_id" "carrier_id" NOT NULL,
    "claim_number" TEXT NOT NULL,
    "patient_token" TEXT NOT NULL,
    "billed_amount" DECIMAL(10,2) NOT NULL,
    "outstanding_amount" DECIMAL(10,2) NOT NULL,
    "days_outstanding" INTEGER NOT NULL,
    "serviced_at" TIMESTAMP(3),
    "status" "claim_status" NOT NULL DEFAULT 'PENDING',
    "priority" "claim_priority" NOT NULL DEFAULT 'NORMAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "insurance_claims_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "call_attempts" (
    "id" TEXT NOT NULL,
    "claim_id" TEXT NOT NULL,
    "vapi_call_id" TEXT NOT NULL,
    "initiated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "duration_seconds" INTEGER,
    "outcome" "call_outcome",
    "outcome_detail" TEXT,
    "rep_name" TEXT,
    "reference_number" TEXT,
    "transcript_url" TEXT,
    "carrier_block_detected" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "call_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "carrier_block_events" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "carrier_id" "carrier_id" NOT NULL,
    "blocked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resumed_at" TIMESTAMP(3),
    "resumed_by" TEXT,
    "notes" TEXT,
    CONSTRAINT "carrier_block_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "call_queue" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "claim_id" TEXT NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "priority" "claim_priority" NOT NULL DEFAULT 'NORMAL',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "status" "queue_status" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "call_queue_pkey" PRIMARY KEY ("id")
);

-- ─── FKs (idempotent: skip if already present) ─────────────────────────────
DO $$ BEGIN
  ALTER TABLE "call_attempts" ADD CONSTRAINT "call_attempts_claim_id_fkey"
    FOREIGN KEY ("claim_id") REFERENCES "insurance_claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "call_queue" ADD CONSTRAINT "call_queue_claim_id_fkey"
    FOREIGN KEY ("claim_id") REFERENCES "insurance_claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Indexes (IF NOT EXISTS) ───────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "insurance_claims_practice_id_claim_number_key" ON "insurance_claims"("practice_id", "claim_number");
CREATE INDEX IF NOT EXISTS "insurance_claims_practice_id_carrier_id_idx" ON "insurance_claims"("practice_id", "carrier_id");
CREATE INDEX IF NOT EXISTS "insurance_claims_practice_id_status_idx" ON "insurance_claims"("practice_id", "status");
CREATE INDEX IF NOT EXISTS "insurance_claims_carrier_id_days_outstanding_idx" ON "insurance_claims"("carrier_id", "days_outstanding");

CREATE UNIQUE INDEX IF NOT EXISTS "call_attempts_vapi_call_id_key" ON "call_attempts"("vapi_call_id");
CREATE INDEX IF NOT EXISTS "call_attempts_claim_id_idx" ON "call_attempts"("claim_id");
CREATE INDEX IF NOT EXISTS "call_attempts_vapi_call_id_idx" ON "call_attempts"("vapi_call_id");
CREATE INDEX IF NOT EXISTS "call_attempts_outcome_idx" ON "call_attempts"("outcome");
CREATE INDEX IF NOT EXISTS "call_attempts_initiated_at_idx" ON "call_attempts"("initiated_at" DESC);

CREATE INDEX IF NOT EXISTS "carrier_block_events_practice_id_carrier_id_blocked_at_idx" ON "carrier_block_events"("practice_id", "carrier_id", "blocked_at" DESC);
CREATE INDEX IF NOT EXISTS "carrier_block_events_resumed_at_idx" ON "carrier_block_events"("resumed_at");

CREATE UNIQUE INDEX IF NOT EXISTS "call_queue_claim_id_key" ON "call_queue"("claim_id");
CREATE INDEX IF NOT EXISTS "call_queue_practice_id_status_idx" ON "call_queue"("practice_id", "status");
CREATE INDEX IF NOT EXISTS "call_queue_scheduled_for_idx" ON "call_queue"("scheduled_for");
CREATE INDEX IF NOT EXISTS "call_queue_practice_id_priority_scheduled_for_idx" ON "call_queue"("practice_id", "priority", "scheduled_for");
