-- Consent attestation and agent permission records (policy research HP#1, HP#9;
-- synthesis H1, H2). Additive only: two new tenant tables, no existing rows
-- touched. Existing practices get NO backfilled attestation; they must attest
-- before the enforcement flag CONSENT_ATTESTATION_ENFORCED is switched on.

CREATE TABLE IF NOT EXISTS "practice_consent_attestations" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "text_version" TEXT NOT NULL,
    "signer_name" TEXT NOT NULL,
    "signer_role" TEXT NOT NULL,
    "attested_by_user_id" TEXT,
    "attested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "revoked_by_user_id" TEXT,
    "revocation_reason" TEXT,
    "superseded_at" TIMESTAMP(3),

    CONSTRAINT "practice_consent_attestations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "practice_consent_attestations_practice_id_attested_at_idx"
    ON "practice_consent_attestations"("practice_id", "attested_at" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'practice_consent_attestations_practice_id_fkey'
  ) THEN
    ALTER TABLE "practice_consent_attestations"
      ADD CONSTRAINT "practice_consent_attestations_practice_id_fkey"
      FOREIGN KEY ("practice_id") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "practice_agent_permissions" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "secondary_use_allowed" BOOLEAN NOT NULL DEFAULT false,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "granted_by_user_id" TEXT,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "practice_agent_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "practice_agent_permissions_practice_id_purpose_key"
    ON "practice_agent_permissions"("practice_id", "purpose");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'practice_agent_permissions_practice_id_fkey'
  ) THEN
    ALTER TABLE "practice_agent_permissions"
      ADD CONSTRAINT "practice_agent_permissions_practice_id_fkey"
      FOREIGN KEY ("practice_id") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Tenant isolation, same shape as 20260926200000_multi_practice_rls_coverage.
ALTER TABLE "practice_consent_attestations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "practice_consent_attestations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "practice_consent_attestations";
CREATE POLICY tenant_isolation ON "practice_consent_attestations" FOR ALL
  USING (app_rls_practice_allowed("practice_id"))
  WITH CHECK (app_rls_practice_allowed("practice_id"));

ALTER TABLE "practice_agent_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "practice_agent_permissions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "practice_agent_permissions";
CREATE POLICY tenant_isolation ON "practice_agent_permissions" FOR ALL
  USING (app_rls_practice_allowed("practice_id"))
  WITH CHECK (app_rls_practice_allowed("practice_id"));
