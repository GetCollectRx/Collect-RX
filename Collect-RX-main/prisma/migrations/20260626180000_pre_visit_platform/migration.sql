-- Pre-visit platform: adjudication graph, scheduled appointments, verification extensions

ALTER TABLE "eligibility_snapshots" ADD COLUMN IF NOT EXISTS "patient_token" TEXT;
CREATE INDEX IF NOT EXISTS "eligibility_snapshots_practice_id_patient_token_carrier_verified_at_idx"
  ON "eligibility_snapshots"("practice_id", "patient_token", "carrier", "verified_at" DESC);

ALTER TABLE "appointment_verifications" ADD COLUMN IF NOT EXISTS "vapi_call_id" TEXT;
ALTER TABLE "appointment_verifications" ADD COLUMN IF NOT EXISTS "attempt_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "appointment_verifications" ADD COLUMN IF NOT EXISTS "missing_artifacts" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "appointment_verifications" ADD COLUMN IF NOT EXISTS "portal_resolved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "appointment_verifications" ADD COLUMN IF NOT EXISTS "tx23_resolved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "appointment_verifications" ADD COLUMN IF NOT EXISTS "scheduled_appointment_id" TEXT;
CREATE INDEX IF NOT EXISTS "appointment_verifications_vapi_call_id_idx"
  ON "appointment_verifications"("vapi_call_id");

CREATE TABLE IF NOT EXISTS "scheduled_appointments" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "patient_token" TEXT NOT NULL,
    "carrier_id" "CarrierId" NOT NULL,
    "procedure_codes" TEXT[],
    "appointment_at" TIMESTAMP(3) NOT NULL,
    "pms_source" TEXT,
    "pms_appointment_id" TEXT,
    "verification_id" TEXT,
    "artifact_attestations" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_appointments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "scheduled_appointments_practice_id_pms_source_pms_appointment_id_key"
  ON "scheduled_appointments"("practice_id", "pms_source", "pms_appointment_id");
CREATE INDEX IF NOT EXISTS "scheduled_appointments_practice_id_appointment_at_idx"
  ON "scheduled_appointments"("practice_id", "appointment_at");

CREATE TABLE IF NOT EXISTS "adjudication_events" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "patient_token" TEXT NOT NULL,
    "carrier_id" "CarrierId" NOT NULL,
    "procedure_codes" TEXT[],
    "call_type" TEXT NOT NULL,
    "eligibility_status" TEXT,
    "predetermination_status" TEXT,
    "denial_reason_code" TEXT,
    "denial_reason_text" TEXT,
    "reconsideration_deadline" TIMESTAMP(3),
    "supporting_docs_present" BOOLEAN,
    "call_duration_ms" INTEGER,
    "vapi_call_id" TEXT,
    "outcome" TEXT NOT NULL,
    "appointment_verification_id" TEXT,
    "claim_id" TEXT,
    "cdcp_case_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adjudication_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "adjudication_events_practice_id_carrier_id_idx"
  ON "adjudication_events"("practice_id", "carrier_id");
CREATE INDEX IF NOT EXISTS "adjudication_events_practice_id_created_at_idx"
  ON "adjudication_events"("practice_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "adjudication_events_carrier_id_denial_reason_code_idx"
  ON "adjudication_events"("carrier_id", "denial_reason_code");
