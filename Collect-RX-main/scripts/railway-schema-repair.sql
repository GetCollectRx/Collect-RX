/**
 * Idempotent schema repairs for Railway prod DB drift.
 * Safe to re-run. Does NOT drop legacy patient-layer tables.
 *
 * Run before baseline:
 *   npx prisma db execute --file scripts/railway-schema-repair.sql
 */
-- Subscription plan columns (20260530223000_subscription_plan_claim_limits)
ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "subscriptionPriceId" TEXT;
ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "subscriptionPlanId" TEXT;
ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "subscriptionCurrentPeriodStart" TIMESTAMP(3);

-- Guardrails (20260519_guardrails) — skip if tables already exist
ALTER TABLE "call_attempts" ADD COLUMN IF NOT EXISTS "transcript_text" TEXT;

CREATE TABLE IF NOT EXISTS "guardrail_audit_outbox" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "call_attempt_id" TEXT NOT NULL UNIQUE REFERENCES "call_attempts"("id") ON DELETE CASCADE,
  "enqueued_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "processed_at" TIMESTAMPTZ,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT
);

CREATE INDEX IF NOT EXISTS "idx_guardrail_audit_outbox_enqueued_at"
  ON "guardrail_audit_outbox"("enqueued_at");
CREATE INDEX IF NOT EXISTS "idx_guardrail_audit_outbox_processed_at"
  ON "guardrail_audit_outbox"("processed_at");

CREATE TABLE IF NOT EXISTS "guardrail_audits" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "call_attempt_id" TEXT NOT NULL REFERENCES "call_attempts"("id") ON DELETE CASCADE,
  "rules_version" TEXT NOT NULL,
  "ran_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "risk_score" NUMERIC(4,3) NOT NULL,
  "violations_json" JSONB NOT NULL,
  "signals_json" JSONB NOT NULL,
  "sidecar_latency_ms" INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_guardrail_audits_unique"
  ON "guardrail_audits"("call_attempt_id", "rules_version");
CREATE INDEX IF NOT EXISTS "idx_guardrail_audits_call_attempt_id"
  ON "guardrail_audits"("call_attempt_id");
CREATE INDEX IF NOT EXISTS "idx_guardrail_audits_risk_score"
  ON "guardrail_audits"("risk_score" DESC);
CREATE INDEX IF NOT EXISTS "idx_guardrail_audits_ran_at"
  ON "guardrail_audits"("ran_at" DESC);
