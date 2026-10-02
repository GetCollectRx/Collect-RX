-- Multi-practice readiness: RLS coverage for the tenant/org tables the
-- 2026-09-25 audit found with none (SHIPPABILITY-BACKLOG.md P0-01). Tenant
-- isolation on these tables previously rested entirely on every Prisma call
-- site remembering an explicit practiceId filter; app_rls_practice_allowed()
-- (defined in 20260712000000_rls_and_phi_vault_practice) was inert on all of
-- them because no policy referenced it.
--
-- Deliberately NOT covered by this migration (tracked separately, not
-- silently dropped):
--   - annual_max_tracking / deductible_tracking: named in the original audit
--     list but do not exist as tables in the current schema — likely stale
--     or renamed since; nothing to add RLS to.
--   - BenefitCoverage, PlanYear, EligibilityCall, PatientBenefits,
--     ReconciliationLog, InsurancePlan: scoped by patientToken/patientId, not
--     practiceId — the same "join through to the owning practice" pattern
--     call_attempts already uses (app_rls_call_attempt_allowed), but via
--     phi_vault_entries/insurance_claims rather than a single FK. These are
--     PHI-adjacent; getting a new join-based policy wrong here is a worse
--     outcome than leaving them at today's (already-defense-in-depth) app-layer
--     scoping a little longer. Needs its own dedicated pass.
--   - Practice itself: a practiceId-shaped policy (id = current_setting(...))
--     is correct for reads (a practice must not see another practice's own
--     row) but wrong for the CREATE case — a brand-new practice's id can
--     never equal any existing session's app.practice_id, by definition, so
--     a WITH CHECK of this shape would reject every practice signup and every
--     org-admin "add a location" flow that isn't already wrapped in bypass.
--     At least one live call site (createOrgPractice, used from an
--     authenticated org-admin session, not a bypassed one) creates a Practice
--     row inside a transaction with no bypass today. Confirmed real, not
--     hypothetical — traced but not fixed in this pass; needs its own
--     decision (e.g. a CREATE-specific policy branch, or explicit bypass at
--     every creation call site) rather than a rushed blanket rule.
--
-- Every route/job/webhook that reads these tables outside an authenticated
-- request (pre-auth login/reset-password/invite routes, the SSO front door,
-- the GoCardless webhook + reconciliation cron, a handful of scheduled
-- notification jobs, the seed script) was audited and wrapped in
-- runWithRlsBypass/runWithRlsContext/runWithPracticeRls in the same change
-- that adds this migration — enabling FORCE RLS without that prerequisite
-- would have silently broken those call paths (zero rows back, not an error).

-- ── Straightforward: non-nullable practiceId, same shape as the 68 tables
--    20260712000000_rls_and_phi_vault_practice already covers ──────────────
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT *
    FROM (
      VALUES
        ('User', 'practiceId'),
        ('InviteToken', 'practiceId'),
        ('CarrierOrder', 'practiceId'),
        ('RuleSet', 'practiceId'),
        ('QueuePriority', 'practiceId'),
        ('platform_admin_practice_grants', 'practice_id'),
        ('pad_mandates', 'practice_id'),
        ('pad_transactions', 'practice_id'),
        ('csv_import_logs', 'practice_id'),
        ('eligibility_snapshots', 'practice_id'),
        ('PmsWritebackLog', 'practiceId'),
        ('organization_practices', 'practice_id'),
        ('phipa_deletion_requests', 'practice_id'),
        ('phipa_breach_notifications', 'practice_id'),
        -- Caught by scripts/check-rls-coverage.mjs (P0-03) rather than by the
        -- original audit list — Ontario dual-coverage tables added after that
        -- audit ran, with the same gap as everything else in this migration.
        ('dentists', 'practice_id'),
        ('cdcp_coverage', 'practice_id'),
        ('human_assisted_call_logs', 'practice_id')
    ) AS t(tbl, col)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = rec.tbl
        AND c.relkind = 'r'
    ) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', rec.tbl);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', rec.tbl);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', rec.tbl);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I FOR ALL USING (app_rls_practice_allowed(%I)) WITH CHECK (app_rls_practice_allowed(%I))',
        rec.tbl,
        rec.col,
        rec.col
      );
    END IF;
  END LOOP;
END $$;

-- ── Nullable practiceId — same shape as the existing feature_flags policy:
--    global/platform rows (practiceId IS NULL) visible only under
--    app.rls_bypass; practice-scoped rows visible when matching ──────────
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT * FROM (
      VALUES
        ('platform_users', 'practice_id'),
        ('auditor_grants', 'practice_id'),
        ('EligibilityEstimateLog', 'practiceId'),
        ('EligibilityReconcileLog', 'practiceId')
    ) AS t(tbl, col)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = rec.tbl AND c.relkind = 'r'
    ) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', rec.tbl);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', rec.tbl);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', rec.tbl);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I
           FOR ALL
           USING (
             current_setting(''app.rls_bypass'', true) = ''true''
             OR (%I IS NOT NULL AND app_rls_practice_allowed(%I))
           )
           WITH CHECK (
             current_setting(''app.rls_bypass'', true) = ''true''
             OR (%I IS NOT NULL AND app_rls_practice_allowed(%I))
           )',
        rec.tbl, rec.col, rec.col, rec.col, rec.col
      );
    END IF;
  END LOOP;
END $$;

-- ── Organization-scoped, no practiceId column at all — new pattern. A row's
--    organization is visible when the session's own practice is a member of
--    that organization (joins through organization_practices, which the
--    first DO block above just gave its own practice_id-scoped policy — the
--    join's explicit WHERE already encodes the same condition that policy
--    enforces, so the two are consistent, not circular). ─────────────────
CREATE OR REPLACE FUNCTION app_rls_organization_allowed(row_organization_id text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    current_setting('app.rls_bypass', true) = 'true'
    OR EXISTS (
      SELECT 1
      FROM organization_practices op
      WHERE op.organization_id = row_organization_id
        AND op.practice_id = NULLIF(current_setting('app.practice_id', true), '')
    );
$$;

COMMENT ON FUNCTION app_rls_organization_allowed IS
  'RLS helper: allow row when the session practice is a member of the row''s organization, or app.rls_bypass is true.';

DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT * FROM (
      VALUES
        ('organization_members', 'organization_id'),
        ('org_compliance_exports', 'organization_id'),
        ('organization_sso_configs', 'organization_id'),
        ('org_sso_events', 'organization_id'),
        ('organization_invite_tokens', 'organization_id')
    ) AS t(tbl, col)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = rec.tbl AND c.relkind = 'r'
    ) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', rec.tbl);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', rec.tbl);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', rec.tbl);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I FOR ALL USING (app_rls_organization_allowed(%I)) WITH CHECK (app_rls_organization_allowed(%I))',
        rec.tbl, rec.col, rec.col
      );
    END IF;
  END LOOP;
END $$;
