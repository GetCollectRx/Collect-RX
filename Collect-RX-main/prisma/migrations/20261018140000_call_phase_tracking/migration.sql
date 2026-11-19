-- Hybrid call flow: phase history, chosen ending and per-phase seconds on the call attempt.
-- All columns are nullable and written only while HYBRID_CALL_FLOW is on, so existing rows and
-- behaviour are untouched. No new table: row level security on call_attempts already applies.
ALTER TABLE "call_attempts"
  ADD COLUMN "call_phase" TEXT,
  ADD COLUMN "phase_history" JSONB,
  ADD COLUMN "call_ending" TEXT,
  ADD COLUMN "call_ending_reason" TEXT,
  ADD COLUMN "menu_seconds" INTEGER,
  ADD COLUMN "hold_seconds" INTEGER,
  ADD COLUMN "rep_seconds" INTEGER,
  ADD COLUMN "staff_agent_seconds" INTEGER,
  ADD COLUMN "wrap_up_seconds" INTEGER;

ALTER TABLE "call_attempts"
  ADD CONSTRAINT "call_attempts_call_phase_check"
    CHECK ("call_phase" IS NULL OR "call_phase" IN ('dialing', 'phone_menu', 'hold', 'rep_answered', 'staff_or_agent', 'wrap_up')),
  ADD CONSTRAINT "call_attempts_call_ending_check"
    CHECK ("call_ending" IS NULL OR "call_ending" IN ('staff', 'agent')),
  ADD CONSTRAINT "call_attempts_phase_seconds_check"
    CHECK (
      ("menu_seconds" IS NULL OR "menu_seconds" >= 0) AND
      ("hold_seconds" IS NULL OR "hold_seconds" >= 0) AND
      ("rep_seconds" IS NULL OR "rep_seconds" >= 0) AND
      ("staff_agent_seconds" IS NULL OR "staff_agent_seconds" >= 0) AND
      ("wrap_up_seconds" IS NULL OR "wrap_up_seconds" >= 0)
    );
