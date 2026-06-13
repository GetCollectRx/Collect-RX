-- Practice partnerships marketing pipeline
CREATE TYPE "ProspectStage" AS ENUM (
  'new',
  'contacted',
  'engaged',
  'qualified',
  'demo_booked',
  'closed_won',
  'closed_lost',
  'opted_out'
);

CREATE TYPE "ProspectSource" AS ENUM (
  'harvest',
  'manual',
  'early_access',
  'referral'
);

CREATE TABLE "prospects" (
  "id" TEXT NOT NULL,
  "practice_name" TEXT NOT NULL,
  "contact_name" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "city" TEXT,
  "province" TEXT,
  "website" TEXT,
  "google_place_id" TEXT,
  "score" INTEGER NOT NULL DEFAULT 0,
  "stage" "ProspectStage" NOT NULL DEFAULT 'new',
  "source" "ProspectSource" NOT NULL DEFAULT 'manual',
  "pms_hint" TEXT,
  "sequence_step" INTEGER NOT NULL DEFAULT 0,
  "sequence_paused_until" TIMESTAMP(3),
  "sequence_completed" BOOLEAN NOT NULL DEFAULT false,
  "referral_step" INTEGER NOT NULL DEFAULT 0,
  "referral_completed" BOOLEAN NOT NULL DEFAULT false,
  "email_open_count" INTEGER NOT NULL DEFAULT 0,
  "email_click_count" INTEGER NOT NULL DEFAULT 0,
  "last_email_sent_at" TIMESTAMP(3),
  "last_engaged_at" TIMESTAMP(3),
  "closed_won_at" TIMESTAMP(3),
  "opt_out_at" TIMESTAMP(3),
  "call_summary" TEXT,
  "reply_intent" TEXT,
  "suggested_reply" TEXT,
  "pain_points" JSONB,
  "metadata" JSONB,
  "last_vapi_call_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "prospects_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "prospect_activities" (
  "id" TEXT NOT NULL,
  "prospect_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "prospect_activities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "prospects_stage_idx" ON "prospects"("stage");
CREATE INDEX "prospects_email_idx" ON "prospects"("email");
CREATE INDEX "prospects_created_at_idx" ON "prospects"("created_at");
CREATE INDEX "prospect_activities_prospect_id_created_at_idx" ON "prospect_activities"("prospect_id", "created_at");

ALTER TABLE "prospect_activities"
  ADD CONSTRAINT "prospect_activities_prospect_id_fkey"
  FOREIGN KEY ("prospect_id") REFERENCES "prospects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
