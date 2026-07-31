-- Practice-scoped, AES-GCM encrypted credentials for pre-call triage channels.
-- Plaintext credentials are intentionally never persisted or audited.

CREATE TABLE "triage_credentials" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "auth_tag" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "triage_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "triage_credentials_practice_id_key"
    ON "triage_credentials"("practice_id");

ALTER TABLE "triage_credentials"
    ADD CONSTRAINT "triage_credentials_practice_id_fkey"
    FOREIGN KEY ("practice_id") REFERENCES "Practice"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "triage_audits" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "credential_id" TEXT,
    "action" TEXT NOT NULL,
    "actor" TEXT,
    "correlation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "triage_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "triage_audits_practice_id_created_at_idx"
    ON "triage_audits"("practice_id", "created_at" DESC);
CREATE INDEX "triage_audits_credential_id_created_at_idx"
    ON "triage_audits"("credential_id", "created_at" DESC);

ALTER TABLE "triage_audits"
    ADD CONSTRAINT "triage_audits_practice_id_fkey"
    FOREIGN KEY ("practice_id") REFERENCES "Practice"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "triage_audits"
    ADD CONSTRAINT "triage_audits_credential_id_fkey"
    FOREIGN KEY ("credential_id") REFERENCES "triage_credentials"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- The RLS helper was introduced by 20260712000000_rls_and_phi_vault_practice.
-- Force policies so even the table owner is scoped unless a platform job enters
-- the explicit bypass context.
ALTER TABLE "triage_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "triage_credentials" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "triage_credentials"
    FOR ALL
    USING (app_rls_practice_allowed("practice_id"))
    WITH CHECK (app_rls_practice_allowed("practice_id"));

ALTER TABLE "triage_audits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "triage_audits" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "triage_audits"
    FOR ALL
    USING (app_rls_practice_allowed("practice_id"))
    WITH CHECK (app_rls_practice_allowed("practice_id"));

COMMENT ON TABLE "triage_credentials" IS
    'Encrypted pre-call triage credentials. Access only through triageCredentialService.';
COMMENT ON TABLE "triage_audits" IS
    'Append-only audit of triage credential saves and reads. Contains no credential values.';
