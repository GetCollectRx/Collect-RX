-- Defense-in-depth: PostgreSQL RLS for tenant-scoped tables + practice_id on PHI vault.
--
-- Session variables (transaction-local, set by Prisma RLS extension):
--   app.practice_id  — tenant scope for authenticated requests / per-practice jobs
--   app.rls_bypass   — 'true' for platform workers, seeds, migrations tooling

-- ── PHI vault: bind tokens to owning practice ────────────────────────────────

ALTER TABLE "phi_vault_entries" ADD COLUMN IF NOT EXISTS "practice_id" TEXT;

UPDATE "phi_vault_entries" pve
SET "practice_id" = ic."practice_id"
FROM "insurance_claims" ic
WHERE ic."patient_token" = pve."token"
  AND pve."practice_id" IS NULL;

DELETE FROM "phi_vault_entries" WHERE "practice_id" IS NULL;

ALTER TABLE "phi_vault_entries" ALTER COLUMN "practice_id" SET NOT NULL;

ALTER TABLE "phi_vault_entries"
  ADD CONSTRAINT "phi_vault_entries_practice_id_fkey"
  FOREIGN KEY ("practice_id") REFERENCES "practices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "phi_vault_entries_practice_id_idx" ON "phi_vault_entries" ("practice_id");

-- ── RLS helpers ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app_rls_practice_allowed(row_practice_id text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    current_setting('app.rls_bypass', true) = 'true'
    OR (
      NULLIF(current_setting('app.practice_id', true), '') IS NOT NULL
      AND row_practice_id = current_setting('app.practice_id', true)
    );
$$;

CREATE OR REPLACE FUNCTION app_rls_call_attempt_allowed(p_claim_id text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    current_setting('app.rls_bypass', true) = 'true'
    OR EXISTS (
      SELECT 1
      FROM "insurance_claims" ic
      WHERE ic."id" = p_claim_id
        AND ic."practice_id" = NULLIF(current_setting('app.practice_id', true), '')
    );
$$;

-- Apply FORCE RLS so policies apply even to the table owner connection.
-- Platform jobs must set app.rls_bypass = true.

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'insurance_claims',
    'claim_recovery_actions',
    'claim_recovery_events',
    'call_queue',
    'practice_notifications',
    'audit_logs',
    'work_items',
    'appointment_verifications',
    'scheduled_appointments',
    'adjudication_events',
    'cdcp_reconsideration_cases',
    'carrier_block_events',
    'call_transcript_lines',
    'call_escalations',
    'emr_sync_outbox',
    'phi_vault_entries',
    'practice_desk_state',
    'pms_import_runs',
    'desktop_connector_agents',
    'ar_close_runs',
    'usage_periods',
    'phipa_deletion_requests',
    'phipa_breach_notifications'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL USING (app_rls_practice_allowed(practice_id)) WITH CHECK (app_rls_practice_allowed(practice_id))',
      tbl
    );
  END LOOP;
END $$;

ALTER TABLE "call_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "call_attempts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "call_attempts";
CREATE POLICY tenant_isolation ON "call_attempts"
  FOR ALL
  USING (app_rls_call_attempt_allowed(claim_id))
  WITH CHECK (app_rls_call_attempt_allowed(claim_id));

-- Global feature flags (practice_id NULL) — visible only with bypass.
ALTER TABLE "feature_flags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feature_flags" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "feature_flags";
CREATE POLICY tenant_isolation ON "feature_flags"
  FOR ALL
  USING (
    current_setting('app.rls_bypass', true) = 'true'
    OR (
      practice_id IS NOT NULL
      AND app_rls_practice_allowed(practice_id)
    )
  )
  WITH CHECK (
    current_setting('app.rls_bypass', true) = 'true'
    OR (
      practice_id IS NOT NULL
      AND app_rls_practice_allowed(practice_id)
    )
  );

COMMENT ON FUNCTION app_rls_practice_allowed IS
  'RLS helper: allow row when app.practice_id matches or app.rls_bypass is true.';
