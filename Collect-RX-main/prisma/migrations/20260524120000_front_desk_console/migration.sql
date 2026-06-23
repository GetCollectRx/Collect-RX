-- Front desk live console: transcript lines, desk queue pause, live call fields
ALTER TABLE "call_attempts" ADD COLUMN IF NOT EXISTS "live_state" TEXT;
ALTER TABLE "call_attempts" ADD COLUMN IF NOT EXISTS "active_agent" TEXT;
ALTER TABLE "call_attempts" ADD COLUMN IF NOT EXISTS "paused_by_staff_at" TIMESTAMP(3);
ALTER TABLE "call_attempts" ADD COLUMN IF NOT EXISTS "paused_by_staff_id" TEXT;
ALTER TABLE "call_attempts" ADD COLUMN IF NOT EXISTS "taken_over_by_staff_at" TIMESTAMP(3);
ALTER TABLE "call_attempts" ADD COLUMN IF NOT EXISTS "taken_over_by_staff_id" TEXT;

CREATE TABLE IF NOT EXISTS "call_transcript_lines" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "vapi_call_id" TEXT NOT NULL,
    "speaker" TEXT NOT NULL,
    "agent_name" TEXT,
    "text" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "call_transcript_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "call_transcript_lines_vapi_call_id_recorded_at_idx"
  ON "call_transcript_lines"("vapi_call_id", "recorded_at");
CREATE INDEX IF NOT EXISTS "call_transcript_lines_practice_id_vapi_call_id_idx"
  ON "call_transcript_lines"("practice_id", "vapi_call_id");

CREATE TABLE IF NOT EXISTS "practice_desk_state" (
    "practice_id" TEXT NOT NULL,
    "queue_paused" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "practice_desk_state_pkey" PRIMARY KEY ("practice_id")
);
