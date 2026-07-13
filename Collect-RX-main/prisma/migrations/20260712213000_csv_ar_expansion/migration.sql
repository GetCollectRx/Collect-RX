-- CSV-first AR expansion. All new operational records are tenant-scoped.
-- This migration is additive; run and verify on staging before production.

ALTER TYPE "recovery_action_type" ADD VALUE IF NOT EXISTS 'DENIAL_REVIEW';
ALTER TYPE "recovery_action_type" ADD VALUE IF NOT EXISTS 'UNDERPAYMENT_REVIEW';
ALTER TYPE "recovery_action_type" ADD VALUE IF NOT EXISTS 'SUBMISSION_QUALITY';

ALTER TABLE "Practice"
  ADD COLUMN "recovery_mode" TEXT NOT NULL DEFAULT 'CSV_FIRST';

ALTER TABLE "insurance_claims"
  ADD COLUMN "denial_reason_code" TEXT,
  ADD COLUMN "denial_reason_text" TEXT,
  ADD COLUMN "denial_date" TIMESTAMP(3),
  ADD COLUMN "appeal_deadline" TIMESTAMP(3);

CREATE TABLE "organizations" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "organization_practices" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "practice_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_practices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "organization_practices_organization_id_practice_id_key"
  ON "organization_practices"("organization_id", "practice_id");
CREATE INDEX "organization_practices_practice_id_idx" ON "organization_practices"("practice_id");
ALTER TABLE "organization_practices"
  ADD CONSTRAINT "organization_practices_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_practices"
  ADD CONSTRAINT "organization_practices_practice_id_fkey"
  FOREIGN KEY ("practice_id") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "organization_members" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'org_admin',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key"
  ON "organization_members"("organization_id", "user_id");
CREATE INDEX "organization_members_user_id_idx" ON "organization_members"("user_id");
ALTER TABLE "organization_members"
  ADD CONSTRAINT "organization_members_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_members"
  ADD CONSTRAINT "organization_members_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "phi_access_events" (
  "id" TEXT NOT NULL,
  "practice_id" TEXT NOT NULL,
  "actor_id" TEXT,
  "operation" TEXT NOT NULL,
  "record_type" TEXT NOT NULL,
  "record_id" TEXT NOT NULL,
  "purpose" TEXT,
  "correlation_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "phi_access_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "phi_access_events_practice_id_created_at_idx" ON "phi_access_events"("practice_id", "created_at");
CREATE INDEX "phi_access_events_record_type_record_id_idx" ON "phi_access_events"("record_type", "record_id");
CREATE INDEX "phi_access_events_actor_id_created_at_idx" ON "phi_access_events"("actor_id", "created_at");

CREATE TABLE "claim_evidence_items" (
  "id" TEXT NOT NULL,
  "practice_id" TEXT NOT NULL,
  "claim_id" TEXT NOT NULL,
  "recovery_action_id" TEXT,
  "evidence_type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'REQUIRED',
  "attested_at" TIMESTAMP(3),
  "attested_by" TEXT,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "claim_evidence_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "claim_evidence_items_claim_id_recovery_action_id_evidence_type_key"
  ON "claim_evidence_items"("claim_id", "recovery_action_id", "evidence_type");
CREATE INDEX "claim_evidence_items_practice_id_status_idx" ON "claim_evidence_items"("practice_id", "status");
ALTER TABLE "claim_evidence_items"
  ADD CONSTRAINT "claim_evidence_items_claim_id_fkey"
  FOREIGN KEY ("claim_id") REFERENCES "insurance_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "claim_submissions" (
  "id" TEXT NOT NULL,
  "practice_id" TEXT NOT NULL,
  "claim_id" TEXT NOT NULL,
  "recovery_action_id" TEXT,
  "method" TEXT NOT NULL,
  "reference_number" TEXT,
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submitted_by" TEXT,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "claim_submissions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "claim_submissions_practice_id_submitted_at_idx" ON "claim_submissions"("practice_id", "submitted_at");
CREATE INDEX "claim_submissions_claim_id_idx" ON "claim_submissions"("claim_id");
ALTER TABLE "claim_submissions"
  ADD CONSTRAINT "claim_submissions_claim_id_fkey"
  FOREIGN KEY ("claim_id") REFERENCES "insurance_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "evidence_pack_exports" (
  "id" TEXT NOT NULL,
  "practice_id" TEXT NOT NULL,
  "claim_id" TEXT NOT NULL,
  "exported_by" TEXT,
  "checksum" TEXT NOT NULL,
  "format" TEXT NOT NULL DEFAULT 'JSON',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "evidence_pack_exports_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "evidence_pack_exports_practice_id_created_at_idx" ON "evidence_pack_exports"("practice_id", "created_at");
CREATE INDEX "evidence_pack_exports_claim_id_idx" ON "evidence_pack_exports"("claim_id");
ALTER TABLE "evidence_pack_exports"
  ADD CONSTRAINT "evidence_pack_exports_claim_id_fkey"
  FOREIGN KEY ("claim_id") REFERENCES "insurance_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "underpayment_cases" (
  "id" TEXT NOT NULL,
  "practice_id" TEXT NOT NULL,
  "claim_id" TEXT NOT NULL,
  "expected_cents" INTEGER NOT NULL,
  "paid_cents" INTEGER NOT NULL,
  "variance_cents" INTEGER NOT NULL,
  "reason_code" TEXT,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  CONSTRAINT "underpayment_cases_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "underpayment_cases_claim_id_expected_cents_paid_cents_key"
  ON "underpayment_cases"("claim_id", "expected_cents", "paid_cents");
CREATE INDEX "underpayment_cases_practice_id_status_idx" ON "underpayment_cases"("practice_id", "status");
ALTER TABLE "underpayment_cases"
  ADD CONSTRAINT "underpayment_cases_claim_id_fkey"
  FOREIGN KEY ("claim_id") REFERENCES "insurance_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- New tenant tables use the same FORCE RLS boundary as the existing recovery
-- ledger. Organization membership is enforced by application authorization;
-- organization rows themselves contain no PHI or claim data.
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT * FROM (
      VALUES
        ('phi_access_events', 'practice_id'),
        ('claim_evidence_items', 'practice_id'),
        ('claim_submissions', 'practice_id'),
        ('evidence_pack_exports', 'practice_id'),
        ('underpayment_cases', 'practice_id')
    ) AS t(tbl, col)
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', rec.tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', rec.tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (app_rls_practice_allowed(%I)) WITH CHECK (app_rls_practice_allowed(%I))', rec.tbl || '_practice_scope', rec.tbl, rec.col, rec.col);
  END LOOP;
END $$;
