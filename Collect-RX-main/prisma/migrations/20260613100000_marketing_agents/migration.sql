-- Migration: 20260613100000_marketing_agents
-- Adds outbound marketing pipeline tables for the partnership growth program.
-- ProspectPractice  → dental practices we are actively targeting
-- ProspectSequence  → multi-step outreach campaign per prospect
-- ProspectEvent     → full audit trail of every marketing touch

-- Enums
CREATE TYPE "prospect_stage" AS ENUM (
  'new',
  'contacted',
  'engaged',
  'qualified',
  'demo_scheduled',
  'proposal_sent',
  'closed_won',
  'closed_lost',
  'not_interested'
);

CREATE TYPE "prospect_source" AS ENUM (
  'google_places',
  'directory',
  'referral',
  'manual',
  'landing_page'
);

CREATE TYPE "practice_size" AS ENUM (
  'solo',
  'small_group',
  'large_group'
);

CREATE TYPE "outreach_sequence_type" AS ENUM (
  'email_cadence',
  'voice_call',
  'manual'
);

CREATE TYPE "outreach_sequence_status" AS ENUM (
  'active',
  'paused',
  'completed',
  'stopped'
);

CREATE TYPE "prospect_event_type" AS ENUM (
  'email_sent',
  'email_opened',
  'email_clicked',
  'email_replied',
  'email_bounced',
  'call_attempted',
  'call_connected',
  'call_outcome',
  'demo_booked',
  'stage_changed',
  'note_added',
  'unsubscribed',
  'harvested'
);

-- ProspectPractice
CREATE TABLE "prospect_practices" (
  "id"                  TEXT         NOT NULL,
  "name"                TEXT         NOT NULL,
  "city"                TEXT,
  "province"            TEXT,
  "postal_code"         TEXT,
  "phone"               TEXT,
  "email"               TEXT,
  "website"             TEXT,
  "practice_size"       "practice_size",
  "pms_guess"           TEXT,
  "source"              "prospect_source"  NOT NULL DEFAULT 'manual',
  "stage"               "prospect_stage"   NOT NULL DEFAULT 'new',
  "score"               INTEGER            NOT NULL DEFAULT 50,
  "assigned_to_id"      TEXT,
  "linked_practice_id"  TEXT               UNIQUE,
  "notes"               TEXT,
  "opted_out_at"        TIMESTAMP(3),
  "dncl_checked_at"     TIMESTAMP(3),
  "created_at"          TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3)       NOT NULL,

  CONSTRAINT "prospect_practices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "prospect_practices_stage_idx"      ON "prospect_practices"("stage");
CREATE INDEX "prospect_practices_score_idx"      ON "prospect_practices"("score");
CREATE INDEX "prospect_practices_created_at_idx" ON "prospect_practices"("created_at");

ALTER TABLE "prospect_practices"
  ADD CONSTRAINT "prospect_practices_linked_practice_id_fkey"
  FOREIGN KEY ("linked_practice_id") REFERENCES "practices"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ProspectSequence
CREATE TABLE "prospect_sequences" (
  "id"             TEXT                     NOT NULL,
  "prospect_id"    TEXT                     NOT NULL,
  "sequence_type"  "outreach_sequence_type" NOT NULL,
  "status"         "outreach_sequence_status" NOT NULL DEFAULT 'active',
  "current_step"   INTEGER                  NOT NULL DEFAULT 0,
  "total_steps"    INTEGER                  NOT NULL,
  "next_run_at"    TIMESTAMP(3),
  "started_at"     TIMESTAMP(3)             NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at"   TIMESTAMP(3),
  "created_at"     TIMESTAMP(3)             NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3)             NOT NULL,

  CONSTRAINT "prospect_sequences_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "prospect_sequences_prospect_id_idx" ON "prospect_sequences"("prospect_id");
CREATE INDEX "prospect_sequences_next_run_at_idx" ON "prospect_sequences"("next_run_at");
CREATE INDEX "prospect_sequences_status_idx"      ON "prospect_sequences"("status");

ALTER TABLE "prospect_sequences"
  ADD CONSTRAINT "prospect_sequences_prospect_id_fkey"
  FOREIGN KEY ("prospect_id") REFERENCES "prospect_practices"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ProspectEvent
CREATE TABLE "prospect_events" (
  "id"           TEXT                  NOT NULL,
  "prospect_id"  TEXT                  NOT NULL,
  "sequence_id"  TEXT,
  "type"         "prospect_event_type" NOT NULL,
  "metadata"     JSONB,
  "occurred_at"  TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "prospect_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "prospect_events_prospect_id_idx" ON "prospect_events"("prospect_id");
CREATE INDEX "prospect_events_occurred_at_idx" ON "prospect_events"("occurred_at");
CREATE INDEX "prospect_events_type_idx"        ON "prospect_events"("type");

ALTER TABLE "prospect_events"
  ADD CONSTRAINT "prospect_events_prospect_id_fkey"
  FOREIGN KEY ("prospect_id") REFERENCES "prospect_practices"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "prospect_events"
  ADD CONSTRAINT "prospect_events_sequence_id_fkey"
  FOREIGN KEY ("sequence_id") REFERENCES "prospect_sequences"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
