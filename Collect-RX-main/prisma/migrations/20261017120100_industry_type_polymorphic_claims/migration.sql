-- Multi-vertical expansion, Phase 1: polymorphic claim fields.
--
-- Purely additive. Every existing insurance_claims row becomes industry_type =
-- 'DENTAL' via the column default; no backfill, no rewrite of existing columns.
--
-- RLS: insurance_claims is already ENABLE + FORCE RLS with a practice_id policy
-- (20260712000000_rls_and_phi_vault_practice). New columns on the same table
-- inherit that isolation; no new table is created, so no new policy is needed
-- and scripts/check-rls-coverage.mjs is unaffected.
--
-- PHI boundary (pii-vault.ts, PHI_IN_EPHEMERAL_CALL_VARIABLES_ONLY): person-linked
-- identifiers (patient id, MRN, VIN, policy number) may only be stored as
-- PIIVault UUID tokens. The CHECK constraints below enforce that at the database
-- so a buggy importer cannot persist a raw VIN or policy number.

-- Prerequisite: 20261017120000_carrier_id_other adds carrier_id = 'other'.

CREATE TYPE "industry_type" AS ENUM (
  'DENTAL',
  'AUTO_COLLISION',
  'PROPERTY_RESTORATION',
  'PARAMEDICAL_PHYSIO',
  'DME',
  'ROOFING_TRADES',
  'NEMT'
);

CREATE TYPE "reference_kind" AS ENUM (
  'PATIENT_ID',
  'MRN',
  'VIN',
  'POLICY_NUMBER',
  'REPAIR_ORDER',
  'JOB_NUMBER',
  'TRIP_ID',
  'SALES_ORDER',
  'CASE_NUMBER'
);

ALTER TABLE "insurance_claims"
  ADD COLUMN "industry_type" "industry_type" NOT NULL DEFAULT 'DENTAL',
  ADD COLUMN "primary_reference_id" TEXT,
  ADD COLUMN "primary_reference_kind" "reference_kind",
  ADD COLUMN "secondary_reference_id" TEXT,
  ADD COLUMN "secondary_reference_kind" "reference_kind",
  ADD COLUMN "payer_name" TEXT,
  ADD COLUMN "line_items" JSONB;

-- An id and its kind travel together.
ALTER TABLE "insurance_claims"
  ADD CONSTRAINT "insurance_claims_primary_reference_pair_chk"
    CHECK (("primary_reference_id" IS NULL) = ("primary_reference_kind" IS NULL)),
  ADD CONSTRAINT "insurance_claims_secondary_reference_pair_chk"
    CHECK (("secondary_reference_id" IS NULL) = ("secondary_reference_kind" IS NULL));

-- Person-linked kinds must be PIIVault tokens (UUID shape), never raw values.
ALTER TABLE "insurance_claims"
  ADD CONSTRAINT "insurance_claims_primary_reference_phi_chk"
    CHECK (
      "primary_reference_kind" IS NULL
      OR "primary_reference_kind" NOT IN ('PATIENT_ID', 'MRN', 'VIN', 'POLICY_NUMBER')
      OR "primary_reference_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ),
  ADD CONSTRAINT "insurance_claims_secondary_reference_phi_chk"
    CHECK (
      "secondary_reference_kind" IS NULL
      OR "secondary_reference_kind" NOT IN ('PATIENT_ID', 'MRN', 'VIN', 'POLICY_NUMBER')
      OR "secondary_reference_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    );

-- line_items is a bounded JSON array when present.
ALTER TABLE "insurance_claims"
  ADD CONSTRAINT "insurance_claims_line_items_array_chk"
    CHECK ("line_items" IS NULL OR (jsonb_typeof("line_items") = 'array' AND jsonb_array_length("line_items") <= 500));

-- Non-dental claims must name their payer.
ALTER TABLE "insurance_claims"
  ADD CONSTRAINT "insurance_claims_other_requires_payer_name_chk"
    CHECK ("carrier_id" <> 'other' OR ("payer_name" IS NOT NULL AND length(btrim("payer_name")) > 0));
CREATE INDEX "insurance_claims_practice_id_industry_type_status_idx" ON "insurance_claims"("practice_id", "industry_type", "status");
