-- Tier 3: CDCP FK on recovery actions + payment trace query index

ALTER TABLE "claim_recovery_actions"
  ADD COLUMN IF NOT EXISTS "cdcp_case_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'claim_recovery_actions_cdcp_case_id_fkey'
  ) THEN
    ALTER TABLE "claim_recovery_actions"
      ADD CONSTRAINT "claim_recovery_actions_cdcp_case_id_fkey"
      FOREIGN KEY ("cdcp_case_id") REFERENCES "CdcpReconsiderationCase"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "claim_recovery_actions_trace_due_idx"
  ON "claim_recovery_actions"("action_type", "status", "scheduled_recall_at");
