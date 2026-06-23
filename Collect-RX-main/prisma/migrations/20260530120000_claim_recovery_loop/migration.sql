-- Claim recovery loop: routing, gates, sync-verified metrics

CREATE TYPE "recovery_route" AS ENUM ('CALL_CARRIER', 'WAIT_SYNC', 'OPEN_CDCP', 'PRACTICE_GATE', 'STOP');
CREATE TYPE "recovery_action_type" AS ENUM (
  'PROCESSING_RECALL',
  'PAYMENT_TRACE',
  'PAYMENT_VERIFY_SYNC',
  'PRACTICE_RESUBMIT',
  'PRACTICE_DOCS',
  'CDCP_RECONSIDERATION',
  'HUMAN_ESCALATION'
);
CREATE TYPE "recovery_action_status" AS ENUM ('OPEN', 'BLOCKING', 'CLEARED');

ALTER TABLE "insurance_claims"
  ADD COLUMN IF NOT EXISTS "recovery_route" "recovery_route",
  ADD COLUMN IF NOT EXISTS "payment_expected_by" TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS "claim_recovery_actions" (
  "id" TEXT NOT NULL,
  "practice_id" TEXT NOT NULL,
  "claim_id" TEXT NOT NULL,
  "action_type" "recovery_action_type" NOT NULL,
  "status" "recovery_action_status" NOT NULL DEFAULT 'BLOCKING',
  "route" "recovery_route" NOT NULL,
  "title" TEXT NOT NULL,
  "detail" TEXT,
  "scheduled_recall_at" TIMESTAMPTZ,
  "call_attempt_id" TEXT,
  "metadata" JSONB,
  "cleared_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "claim_recovery_actions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "claim_recovery_actions_claim_id_fkey"
    FOREIGN KEY ("claim_id") REFERENCES "insurance_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "claim_recovery_actions_claim_id_status_idx"
  ON "claim_recovery_actions"("claim_id", "status");
CREATE INDEX IF NOT EXISTS "claim_recovery_actions_practice_id_status_idx"
  ON "claim_recovery_actions"("practice_id", "status");

CREATE TABLE IF NOT EXISTS "claim_recovery_events" (
  "id" TEXT NOT NULL,
  "practice_id" TEXT NOT NULL,
  "claim_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "amount_recovered_cents" INTEGER,
  "previous_outstanding" DECIMAL(10,2),
  "new_outstanding" DECIMAL(10,2),
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "claim_recovery_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "claim_recovery_events_claim_id_fkey"
    FOREIGN KEY ("claim_id") REFERENCES "insurance_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "claim_recovery_events_practice_id_created_at_idx"
  ON "claim_recovery_events"("practice_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "claim_recovery_events_claim_id_created_at_idx"
  ON "claim_recovery_events"("claim_id", "created_at" DESC);
