-- Dispatch approval gate: human-in-the-loop checkpoint before a claim's first
-- outbound Vapi call, satisfying the RDC-SO accountability guidance and the
-- PHIPA audit-trail requirement (WHO/WHAT/WHEN/ACTION, immutable, exportable).
-- See docs/operations/HUMAN-DECISIONS-PENDING.md for the product framing and
-- src/carriers/adapter.ts (validateDispatch) for where this is enforced.

CREATE TYPE "dispatch_approval_status" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'SKIPPED');

ALTER TABLE "call_queue"
  ADD COLUMN IF NOT EXISTS "approval_status" "dispatch_approval_status" NOT NULL DEFAULT 'PENDING_REVIEW',
  ADD COLUMN IF NOT EXISTS "approval_decided_by" TEXT,
  ADD COLUMN IF NOT EXISTS "approval_decided_at" TIMESTAMPTZ;

-- Existing rows predate this feature and may already have live dispatch history
-- (attempts > 0) or already be resolved/escalated — none of that is a claim
-- someone is about to newly auto-dial for the first time under this gate, so
-- backfilling them as APPROVED avoids silently freezing every claim already in
-- flight the moment this migration lands. Only genuinely-untouched PENDING
-- rows (attempts = 0, never dispatched) start life under the new gate.
UPDATE "call_queue"
  SET "approval_status" = 'APPROVED'
  WHERE "attempts" > 0 OR "status" NOT IN ('PENDING');

CREATE INDEX IF NOT EXISTS "call_queue_practice_id_approval_status_idx"
  ON "call_queue"("practice_id", "approval_status");

CREATE TABLE IF NOT EXISTS "dispatch_approvals" (
  "id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "practice_id" TEXT NOT NULL,
  "claim_id" TEXT NOT NULL,
  "call_queue_id" TEXT NOT NULL,
  "carrier_id" "carrier_id" NOT NULL,
  "flag_reason_snapshot" TEXT,
  "outstanding_amount_snapshot" DECIMAL(10,2) NOT NULL,
  "decision" "dispatch_approval_status" NOT NULL,
  "decided_by_user_id" TEXT NOT NULL,
  "decided_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  CONSTRAINT "dispatch_approvals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "dispatch_approvals_practice_id_batch_id_idx"
  ON "dispatch_approvals"("practice_id", "batch_id");
CREATE INDEX IF NOT EXISTS "dispatch_approvals_practice_id_decided_at_idx"
  ON "dispatch_approvals"("practice_id", "decided_at");
CREATE INDEX IF NOT EXISTS "dispatch_approvals_claim_id_decided_at_idx"
  ON "dispatch_approvals"("claim_id", "decided_at");

-- Deliberately no FK from dispatch_approvals back to call_queue/insurance_claims:
-- this table is an immutable audit log (same pattern as "AuditLog") and must
-- keep its rows even if the underlying claim is later hard-deleted under a
-- PHIPA deletion request — a cascade delete here would erase the very record
-- an IPC audit would ask for.
