-- request_staff_handoff state on call_attempts. Columns live on the existing
-- table, so the existing call_attempts RLS policy (app_rls_call_attempt_allowed)
-- already scopes them to the owning practice. No new table or policy is needed.
-- Null means the transfer was never requested. REQUESTED with no settlement is
-- an unknown outcome and is never retried automatically.

-- CreateEnum
CREATE TYPE "StaffHandoffState" AS ENUM ('REQUESTED', 'PROVIDER_ACCEPTED', 'FAILED', 'OUTCOME_UNKNOWN');

-- AlterTable
ALTER TABLE "call_attempts" ADD COLUMN "staff_handoff_state" "StaffHandoffState",
ADD COLUMN "staff_handoff_reason" TEXT,
ADD COLUMN "staff_handoff_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "call_attempts_staff_handoff_state_staff_handoff_at_idx" ON "call_attempts"("staff_handoff_state", "staff_handoff_at");
