-- Add call hold and transfer tracking fields to CallAttempt
ALTER TABLE "call_attempts" ADD COLUMN "started_at" TIMESTAMP(3);
ALTER TABLE "call_attempts" ADD COLUMN "ivr_navigation_seconds" INTEGER;
ALTER TABLE "call_attempts" ADD COLUMN "hold_duration_seconds" INTEGER;
ALTER TABLE "call_attempts" ADD COLUMN "hold_timeout_occurred" BOOLEAN NOT NULL DEFAULT false;

-- Create CallTransition model for agent transition tracking
CREATE TABLE "call_transitions" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  "call_attempt_id" TEXT NOT NULL,
  "from_agent" TEXT,
  "to_agent" TEXT NOT NULL,
  "transitioned_at" TIMESTAMP(3) NOT NULL,
  "duration_seconds" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "call_transitions_call_attempt_id_fk" FOREIGN KEY ("call_attempt_id") REFERENCES "call_attempts" ("id") ON DELETE CASCADE
);

-- Create indexes for call_transitions
CREATE INDEX "call_transitions_call_attempt_id_idx" ON "call_transitions"("call_attempt_id");

-- Create indexes for new call_attempts columns for query optimization
CREATE INDEX "call_attempts_started_at_idx" ON "call_attempts"("started_at");
CREATE INDEX "call_attempts_hold_timeout_idx" ON "call_attempts"("hold_timeout_occurred");
