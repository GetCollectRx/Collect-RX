-- V1 Human-Assisted squad: isolated call-log + carrier-profile tables.
-- Not linked to call_attempts/carrier_lessons — see schema.prisma comment.

CREATE TYPE "human_assisted_profile_category" AS ENUM (
  'DOCUMENTATION', 'HOLD_BEHAVIOR', 'STAFF_DECISION', 'DENIAL_PATTERN', 'REP_BEHAVIOR'
);

CREATE TABLE "human_assisted_call_logs" (
  "id" TEXT NOT NULL,
  "claim_id" TEXT,
  "practice_id" TEXT NOT NULL,
  "carrier_id" "CarrierId" NOT NULL,
  "vapi_call_id" TEXT NOT NULL,
  "scenario" TEXT NOT NULL,
  "rep_name" TEXT,
  "reference_number" TEXT,
  "deadline_date" TEXT,
  "deadline_action" TEXT,
  "amount_stated_by_rep" TEXT,
  "matches_expected_amount" BOOLEAN,
  "shortfall_reason" TEXT,
  "documentation_requested" TEXT,
  "submission_method" TEXT,
  "submission_destination" TEXT,
  "denial_or_reduction_code" TEXT,
  "eob_sent_to_patient" BOOLEAN,
  "eob_sent_date" TEXT,
  "appeal_rights" TEXT,
  "automation_suspicion_flag" BOOLEAN NOT NULL DEFAULT false,
  "call_summary" TEXT NOT NULL,
  "unresolved_fields" TEXT,
  "processed_for_profile_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "human_assisted_call_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "human_assisted_call_logs_vapi_call_id_key" ON "human_assisted_call_logs"("vapi_call_id");
CREATE INDEX "human_assisted_call_logs_carrier_id_processed_for_profile__idx" ON "human_assisted_call_logs"("carrier_id", "processed_for_profile_at");
CREATE INDEX "human_assisted_call_logs_practice_id_created_at_idx" ON "human_assisted_call_logs"("practice_id", "created_at" DESC);
CREATE INDEX "human_assisted_call_logs_claim_id_idx" ON "human_assisted_call_logs"("claim_id");

CREATE TABLE "human_assisted_carrier_profiles" (
  "id" TEXT NOT NULL,
  "carrier_id" "CarrierId" NOT NULL,
  "category" "human_assisted_profile_category" NOT NULL,
  "observation" TEXT NOT NULL,
  "recommendation" TEXT NOT NULL,
  "sample_size" INTEGER NOT NULL DEFAULT 1,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "last_call_log_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "human_assisted_carrier_profiles_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "human_assisted_carrier_profiles_carrier_id_category_idx" ON "human_assisted_carrier_profiles"("carrier_id", "category");
