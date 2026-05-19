-- 1. Add transcript_text column to call_attempts
ALTER TABLE "call_attempts"
ADD COLUMN "transcript_text" TEXT;

-- 2. Create guardrail_audit_outbox table
CREATE TABLE "guardrail_audit_outbox" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "call_attempt_id" UUID NOT NULL UNIQUE REFERENCES "call_attempts"("id") ON DELETE CASCADE,
  "enqueued_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "processed_at" TIMESTAMPTZ,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT
);

CREATE INDEX "idx_guardrail_audit_outbox_enqueued_at" ON "guardrail_audit_outbox"("enqueued_at");
CREATE INDEX "idx_guardrail_audit_outbox_processed_at" ON "guardrail_audit_outbox"("processed_at");

-- 3. Create guardrail_audits table
CREATE TABLE "guardrail_audits" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "call_attempt_id" UUID NOT NULL REFERENCES "call_attempts"("id") ON DELETE CASCADE,
  "rules_version" TEXT NOT NULL,
  "ran_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "risk_score" NUMERIC(4,3) NOT NULL,
  "violations_json" JSONB NOT NULL,
  "signals_json" JSONB NOT NULL,
  "sidecar_latency_ms" INTEGER
);

CREATE UNIQUE INDEX "idx_guardrail_audits_unique" ON "guardrail_audits"("call_attempt_id", "rules_version");
CREATE INDEX "idx_guardrail_audits_call_attempt_id" ON "guardrail_audits"("call_attempt_id");
CREATE INDEX "idx_guardrail_audits_risk_score" ON "guardrail_audits"("risk_score" DESC);
CREATE INDEX "idx_guardrail_audits_ran_at" ON "guardrail_audits"("ran_at" DESC);
