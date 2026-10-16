-- Breach register (policy research HP#2, HP#3, HP#4, PS#12, PS#13; synthesis F5).
-- Additive only: one new tenant table with FORCE RLS. Nothing existing is altered.
-- The legacy phipa_breach_notifications table is left as it is. It has no code
-- references and a required notification_deadline column that this register does not use.

CREATE TABLE IF NOT EXISTS "breach_register_entries" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "circumstances" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3),
    "discovered_at" TIMESTAMP(3) NOT NULL,
    "data_elements" TEXT NOT NULL,
    "individuals_count" INTEGER NOT NULL,
    "affected_tokens" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "steps_to_reduce_harm" TEXT NOT NULL,
    "notification_steps" TEXT NOT NULL,
    "contact_role" TEXT NOT NULL,
    "vendors_involved" TEXT,
    "rros_assessment" TEXT,
    "real_risk_of_significant_harm" BOOLEAN,
    "custodian_notified_at" TIMESTAMP(3),
    "regulator_notified_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "retain_until" TIMESTAMP(3) NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "breach_register_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "breach_register_entries_practice_id_discovered_at_idx"
    ON "breach_register_entries"("practice_id", "discovered_at" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'breach_register_entries_practice_id_fkey'
  ) THEN
    ALTER TABLE "breach_register_entries"
      ADD CONSTRAINT "breach_register_entries_practice_id_fkey"
      FOREIGN KEY ("practice_id") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Tenant isolation, same shape as 20261013120000_consent_attestation_agent_permission.
ALTER TABLE "breach_register_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "breach_register_entries" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "breach_register_entries";
CREATE POLICY tenant_isolation ON "breach_register_entries" FOR ALL
  USING (app_rls_practice_allowed("practice_id"))
  WITH CHECK (app_rls_practice_allowed("practice_id"));
