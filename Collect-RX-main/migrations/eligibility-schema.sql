-- ─────────────────────────────────────────────────────────────────────────────
-- CollectRx — Phase 3 Eligibility Schema Migration
-- PostgreSQL (Railway)
--
-- Tables:
--   1. carrier_configs_cache        — Snapshot of JSON carrier configs for audit
--   2. insurance_plans              — Patient plan records
--   3. eligibility_snapshots        — Verified eligibility data per patient/carrier
--   4. eligibility_estimates        — Pre-treatment estimate records
--   5. estimate_procedures          — Line items within an estimate
--   6. deductible_tracking          — Running deductible state per patient/plan year
--   7. annual_max_tracking          — Running annual max state per patient/plan year
--   8. reconciliation_logs          — Post-insurance reconciliation audit trail
--   9. cdt_code_cache               — Cached CDT code → tier mappings
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE carrier_id AS ENUM (
    'sun_life', 'canada_life', 'manulife', 'green_shield', 'rbc', 'telus_adjudicare'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE coverage_tier AS ENUM ('preventive', 'basic', 'major', 'ortho');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE eligibility_status AS ENUM ('active', 'inactive', 'unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE reconciliation_flag AS ENUM (
    'within_threshold', 'variance_high', 'variance_critical', 'needs_review'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE plan_type AS ENUM ('group', 'individual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. carrier_configs_cache
--    Stores a timestamped copy of the JSON carrier config for audit purposes.
--    When the JSON file is updated, insert a new row.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS carrier_configs_cache (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier          carrier_id NOT NULL,
  config_json      JSONB NOT NULL,
  effective_from   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE carrier_configs_cache IS
  'Audit trail of carrier rule configs. Insert new rows when JSON config changes.';

CREATE INDEX IF NOT EXISTS idx_carrier_configs_carrier
  ON carrier_configs_cache (carrier, effective_from DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. insurance_plans
--    One row per patient insurance enrollment.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS insurance_plans (
  plan_id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id                TEXT NOT NULL,            -- FK to patients table
  carrier                   carrier_id NOT NULL,
  plan_name                 TEXT NOT NULL,
  group_number              TEXT NOT NULL,
  member_id                 TEXT NOT NULL,
  effective_date            DATE NOT NULL,
  termination_date          DATE,
  plan_type                 plan_type NOT NULL DEFAULT 'group',
  is_primary                BOOLEAN NOT NULL DEFAULT TRUE,
  telus_underlying_tpa      TEXT,                     -- TELUS AdjudiCare only
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE insurance_plans IS 'Insurance plan enrollments per patient.';
COMMENT ON COLUMN insurance_plans.telus_underlying_tpa IS
  'For TELUS AdjudiCare: identified TPA (e.g. ClaimSecure, Benecaid). Required before IVR routing.';

CREATE INDEX IF NOT EXISTS idx_insurance_plans_patient ON insurance_plans (patient_id);
CREATE INDEX IF NOT EXISTS idx_insurance_plans_carrier ON insurance_plans (carrier);
CREATE INDEX IF NOT EXISTS idx_insurance_plans_member  ON insurance_plans (member_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. eligibility_snapshots
--    Verified eligibility data obtained from IVR or Abeldent sync.
--    One row per verification event (not updated in-place — append-only).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS eligibility_snapshots (
  snapshot_id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id                  TEXT NOT NULL,
  carrier                     carrier_id NOT NULL,
  plan_id                     UUID REFERENCES insurance_plans(plan_id),
  status                      eligibility_status NOT NULL DEFAULT 'unknown',
  verified_at                 TIMESTAMPTZ NOT NULL,
  deductible_individual_met   NUMERIC(10,2) NOT NULL DEFAULT 0,
  deductible_family_met       NUMERIC(10,2) NOT NULL DEFAULT 0,
  annual_max_used_individual  NUMERIC(10,2) NOT NULL DEFAULT 0,
  annual_max_used_family      NUMERIC(10,2),
  plan_year_start             DATE NOT NULL,
  raw_carrier_response        JSONB,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE eligibility_snapshots IS
  'Append-only log of eligibility verifications. Query latest by patient/carrier for estimates.';

CREATE INDEX IF NOT EXISTS idx_eligibility_snapshots_patient_carrier
  ON eligibility_snapshots (patient_id, carrier, verified_at DESC);

CREATE INDEX IF NOT EXISTS idx_eligibility_snapshots_plan_year
  ON eligibility_snapshots (patient_id, plan_year_start);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. eligibility_estimates
--    One row per generated pre-treatment estimate.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS eligibility_estimates (
  estimate_id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id                    TEXT NOT NULL,
  carrier                       carrier_id NOT NULL,
  snapshot_id                   UUID REFERENCES eligibility_snapshots(snapshot_id),
  generated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider_fee_total            NUMERIC(10,2) NOT NULL,
  insurance_total               NUMERIC(10,2) NOT NULL,
  patient_total                 NUMERIC(10,2) NOT NULL,
  deductible_applied_total      NUMERIC(10,2) NOT NULL DEFAULT 0,
  confidence_score              SMALLINT NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
  confidence_notes              TEXT[],
  eligibility_status            eligibility_status NOT NULL,
  estimated_deductible_remaining NUMERIC(10,2) NOT NULL DEFAULT 0,
  estimated_annual_max_remaining NUMERIC(10,2) NOT NULL DEFAULT 0,
  -- COB fields (null if single coverage)
  secondary_carrier             carrier_id,
  cob_primary_pays              NUMERIC(10,2),
  cob_secondary_pays            NUMERIC(10,2),
  cob_patient_after_cob         NUMERIC(10,2),
  cob_birthday_rule_applied     BOOLEAN,
  cob_notes                     TEXT[],
  raw_estimate_json             JSONB NOT NULL,         -- full estimate for replay/audit
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE eligibility_estimates IS
  'Pre-treatment estimates generated by the eligibility engine.';
COMMENT ON COLUMN eligibility_estimates.raw_estimate_json IS
  'Full serialised EligibilityEstimate for downstream reconciliation and audit.';

CREATE INDEX IF NOT EXISTS idx_estimates_patient   ON eligibility_estimates (patient_id);
CREATE INDEX IF NOT EXISTS idx_estimates_carrier   ON eligibility_estimates (carrier);
CREATE INDEX IF NOT EXISTS idx_estimates_generated ON eligibility_estimates (generated_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. estimate_procedures
--    Line items within an estimate (one row per CDT code per estimate).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estimate_procedures (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id             UUID NOT NULL REFERENCES eligibility_estimates(estimate_id) ON DELETE CASCADE,
  cdt_code                TEXT NOT NULL,
  tier                    coverage_tier NOT NULL,
  provider_fee            NUMERIC(10,2) NOT NULL,
  coverage_percent        SMALLINT NOT NULL,
  gross_insurance_portion NUMERIC(10,2) NOT NULL,
  deductible_applied      NUMERIC(10,2) NOT NULL DEFAULT 0,
  annual_max_cap_applied  NUMERIC(10,2) NOT NULL DEFAULT 0,
  net_insurance_portion   NUMERIC(10,2) NOT NULL,
  patient_portion         NUMERIC(10,2) NOT NULL,
  waiting_period_block    BOOLEAN NOT NULL DEFAULT FALSE,
  frequency_limit_block   BOOLEAN NOT NULL DEFAULT FALSE,
  notes                   TEXT[]
);

CREATE INDEX IF NOT EXISTS idx_estimate_procedures_estimate
  ON estimate_procedures (estimate_id);
CREATE INDEX IF NOT EXISTS idx_estimate_procedures_cdt
  ON estimate_procedures (cdt_code);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. deductible_tracking
--    Running deductible state per patient per plan year.
--    Updated when an estimate is generated or a claim is processed.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deductible_tracking (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id            TEXT NOT NULL,
  carrier               carrier_id NOT NULL,
  plan_year_start       DATE NOT NULL,
  individual_met        NUMERIC(10,2) NOT NULL DEFAULT 0,
  family_met            NUMERIC(10,2) NOT NULL DEFAULT 0,
  individual_limit      NUMERIC(10,2) NOT NULL,
  family_limit          NUMERIC(10,2) NOT NULL,
  last_updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source                TEXT,                       -- 'estimate' | 'eob' | 'manual'
  UNIQUE (patient_id, carrier, plan_year_start)
);

COMMENT ON TABLE deductible_tracking IS
  'Running deductible state per patient/carrier/plan year. Upsert when estimates or EOBs are processed.';

CREATE INDEX IF NOT EXISTS idx_deductible_patient_carrier
  ON deductible_tracking (patient_id, carrier);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. annual_max_tracking
--    Running annual max state per patient per plan year.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS annual_max_tracking (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id            TEXT NOT NULL,
  carrier               carrier_id NOT NULL,
  plan_year_start       DATE NOT NULL,
  individual_used       NUMERIC(10,2) NOT NULL DEFAULT 0,
  family_used           NUMERIC(10,2),
  individual_limit      NUMERIC(10,2) NOT NULL,
  family_limit          NUMERIC(10,2),
  last_updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source                TEXT,
  UNIQUE (patient_id, carrier, plan_year_start)
);

COMMENT ON TABLE annual_max_tracking IS
  'Running annual max state per patient/carrier/plan year. Upsert after each estimate or EOB.';

CREATE INDEX IF NOT EXISTS idx_annual_max_patient_carrier
  ON annual_max_tracking (patient_id, carrier);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. reconciliation_logs
--    Post-insurance reconciliation audit trail.
--    One row per reconciliation event (estimate vs. actual adjudication).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reconciliation_logs (
  reconciliation_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id                  TEXT NOT NULL,
  patient_id                TEXT NOT NULL,
  estimate_id               UUID REFERENCES eligibility_estimates(estimate_id),
  reconciled_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  estimated_patient_total   NUMERIC(10,2) NOT NULL,
  actual_patient_total      NUMERIC(10,2) NOT NULL,
  variance                  NUMERIC(10,2) NOT NULL,   -- actual - estimated
  variance_percent          NUMERIC(6,2) NOT NULL,
  flag                      reconciliation_flag NOT NULL,
  patient_balance_adjustment NUMERIC(10,2) NOT NULL,
  variance_reasons          TEXT[],
  requires_human_review     BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_by               TEXT,                     -- staff member who reviewed
  reviewed_at               TIMESTAMPTZ,
  review_notes              TEXT,
  raw_adjudication_json     JSONB NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE reconciliation_logs IS
  'Audit trail of estimate vs. actual adjudication. Flag >$50 variance for human review.';

CREATE INDEX IF NOT EXISTS idx_reconciliation_patient
  ON reconciliation_logs (patient_id, reconciled_at DESC);
CREATE INDEX IF NOT EXISTS idx_reconciliation_claim
  ON reconciliation_logs (claim_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_review
  ON reconciliation_logs (requires_human_review) WHERE requires_human_review = TRUE;
CREATE INDEX IF NOT EXISTS idx_reconciliation_flag
  ON reconciliation_logs (flag);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. cdt_code_cache
--    Cached CDT code → coverage tier mappings.
--    Seeded from cdt-codes.ts; updated if carrier-specific overrides apply.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cdt_code_cache (
  cdt_code          TEXT PRIMARY KEY,
  default_tier      coverage_tier NOT NULL,
  description       TEXT,
  carrier_overrides JSONB,         -- { "sun_life": "major", ... } if a carrier differs
  last_updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE cdt_code_cache IS
  'CDT procedure code to coverage tier mapping. Seeded from engine; supports carrier-specific overrides.';

-- Seed the most common CDT codes
INSERT INTO cdt_code_cache (cdt_code, default_tier, description) VALUES
  ('D0120', 'preventive', 'Periodic oral evaluation'),
  ('D0140', 'basic',      'Limited oral evaluation'),
  ('D0150', 'preventive', 'Comprehensive oral evaluation'),
  ('D0210', 'preventive', 'Intraoral complete series X-rays'),
  ('D0220', 'preventive', 'Periapical X-ray — first image'),
  ('D0230', 'preventive', 'Periapical X-ray — additional'),
  ('D0274', 'preventive', 'Bitewing X-rays — four images'),
  ('D0330', 'basic',      'Panoramic radiographic image'),
  ('D1110', 'preventive', 'Adult prophylaxis'),
  ('D1120', 'preventive', 'Child prophylaxis'),
  ('D1206', 'preventive', 'Topical fluoride varnish'),
  ('D1351', 'preventive', 'Sealant — per tooth'),
  ('D2140', 'basic',      'Amalgam — 1 surface, primary'),
  ('D2150', 'basic',      'Amalgam — 2 surfaces, primary'),
  ('D2160', 'basic',      'Amalgam — 3 surfaces, primary'),
  ('D2391', 'basic',      'Resin composite — 1 surface, primary'),
  ('D2392', 'basic',      'Resin composite — 2 surfaces, primary'),
  ('D2393', 'basic',      'Resin composite — 3 surfaces, primary'),
  ('D2740', 'major',      'Crown — porcelain/ceramic substrate'),
  ('D2750', 'major',      'Crown — PFM high noble metal'),
  ('D2751', 'major',      'Crown — PFM predominantly base metal'),
  ('D2790', 'major',      'Crown — full cast high noble metal'),
  ('D2950', 'basic',      'Core buildup'),
  ('D3310', 'basic',      'RCT — anterior tooth'),
  ('D3320', 'basic',      'RCT — premolar'),
  ('D3330', 'basic',      'RCT — molar'),
  ('D3346', 'basic',      'Retreatment — anterior'),
  ('D3347', 'basic',      'Retreatment — premolar'),
  ('D3348', 'basic',      'Retreatment — molar'),
  ('D4341', 'basic',      'Perio scaling and root planing — per quadrant'),
  ('D4342', 'basic',      'Perio scaling — 1–3 teeth per quadrant'),
  ('D4910', 'preventive', 'Periodontal maintenance'),
  ('D5110', 'major',      'Complete denture — maxillary'),
  ('D5120', 'major',      'Complete denture — mandibular'),
  ('D5211', 'major',      'Partial denture — resin base, maxillary'),
  ('D5212', 'major',      'Partial denture — resin base, mandibular'),
  ('D5213', 'major',      'Partial denture — cast metal, maxillary'),
  ('D5214', 'major',      'Partial denture — cast metal, mandibular'),
  ('D6010', 'major',      'Implant body — endosteal'),
  ('D6240', 'major',      'Pontic — PFM high noble'),
  ('D6750', 'major',      'Retainer crown — PFM high noble'),
  ('D7140', 'basic',      'Extraction — erupted tooth'),
  ('D7210', 'basic',      'Surgical extraction — erupted tooth'),
  ('D7220', 'basic',      'Removal — impacted, soft tissue'),
  ('D7230', 'basic',      'Removal — impacted, partial bony'),
  ('D7240', 'basic',      'Removal — impacted, completely bony'),
  ('D8080', 'ortho',      'Comprehensive ortho — adolescent'),
  ('D8090', 'ortho',      'Comprehensive ortho — adult'),
  ('D8670', 'ortho',      'Periodic orthodontic visit'),
  ('D8680', 'ortho',      'Orthodontic retention'),
  ('D9110', 'basic',      'Emergency pulp treatment'),
  ('D9210', 'basic',      'Local anesthesia'),
  ('D9230', 'basic',      'Nitrous oxide sedation'),
  ('D9910', 'basic',      'Desensitizing medicament application')
ON CONFLICT (cdt_code) DO UPDATE
  SET default_tier    = EXCLUDED.default_tier,
      description     = EXCLUDED.description,
      last_updated_at = NOW();

-- ─────────────────────────────────────────────────────────────────────────────
-- VIEWS
-- ─────────────────────────────────────────────────────────────────────────────

-- Reconciliation queue: all records requiring human review, oldest first
CREATE OR REPLACE VIEW v_reconciliation_review_queue AS
SELECT
  rl.reconciliation_id,
  rl.claim_id,
  rl.patient_id,
  rl.reconciled_at,
  rl.variance,
  rl.variance_percent,
  rl.flag,
  rl.patient_balance_adjustment,
  rl.variance_reasons,
  rl.reviewed_by,
  rl.reviewed_at
FROM reconciliation_logs rl
WHERE rl.requires_human_review = TRUE
  AND rl.reviewed_at IS NULL
ORDER BY rl.reconciled_at ASC;

COMMENT ON VIEW v_reconciliation_review_queue IS
  'Pending reconciliation records requiring human review — sorted oldest first.';

-- Annual max dashboard view
CREATE OR REPLACE VIEW v_annual_max_status AS
SELECT
  amt.patient_id,
  amt.carrier,
  amt.plan_year_start,
  amt.individual_used,
  amt.individual_limit,
  (amt.individual_limit - amt.individual_used) AS individual_remaining,
  ROUND((amt.individual_used / NULLIF(amt.individual_limit, 0)) * 100, 1) AS pct_used,
  CASE
    WHEN amt.individual_used >= amt.individual_limit THEN TRUE
    ELSE FALSE
  END AS is_exhausted,
  amt.last_updated_at
FROM annual_max_tracking amt;

COMMENT ON VIEW v_annual_max_status IS
  'Annual maximum usage status per patient/carrier for the Balances tab.';
