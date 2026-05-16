-- Phase 5: CDCP Reconsideration & High-Precision Adjudication
-- Run: psql $DATABASE_URL -f config/migrations/005_phase5_cdcp.sql

BEGIN;

-- ─── CDCP Denied Claims ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cdcp_denied_claims (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id               VARCHAR(100) NOT NULL UNIQUE,
  patient_token          UUID NOT NULL,
  practice_id            UUID NOT NULL REFERENCES practices(id),
  cdt_code               VARCHAR(10) NOT NULL,
  cda_code               VARCHAR(10),
  denial_reason_code     VARCHAR(10) NOT NULL,  -- F-010 through F-020
  denial_date            DATE NOT NULL,
  original_adjudicator_id VARCHAR(100),
  procedure_fee_cents    INTEGER NOT NULL,
  province               CHAR(2) NOT NULL,
  transaction_type       VARCHAR(5) NOT NULL DEFAULT 'T11',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cdcp_denied_claims_practice
  ON cdcp_denied_claims(practice_id, denial_date DESC);

CREATE INDEX IF NOT EXISTS idx_cdcp_denied_claims_patient
  ON cdcp_denied_claims(patient_token);

-- ─── Reconsideration Records ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cdcp_reconsiderations (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id                     VARCHAR(100) NOT NULL REFERENCES cdcp_denied_claims(claim_id),
  patient_token                UUID NOT NULL,
  practice_id                  UUID NOT NULL REFERENCES practices(id),
  denial_reason_code           VARCHAR(10) NOT NULL,
  denial_date                  DATE NOT NULL,
  deadline_date                DATE NOT NULL,  -- denial_date + 60 days
  urgent_escalation_date       DATE NOT NULL,  -- denial_date + 45 days
  status                       VARCHAR(30) NOT NULL DEFAULT 'eligible'
                               CHECK (status IN ('eligible','urgent','expired','submitted','under_review','approved','denied_final')),
  submission_method            VARCHAR(20) CHECK (submission_method IN ('cdanet_09','paper_fallback')),
  submitted_at                 TIMESTAMPTZ,
  original_adjudicator_id      VARCHAR(100),
  assigned_adjudicator_id      VARCHAR(100),   -- must differ from original
  confirmation_number          VARCHAR(100),   -- Sun Life confirmation on submission
  evidence_checklist_json      JSONB,          -- array of EvidenceChecklistItem
  notes                        TEXT,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Enforce adjudicator rotation: assigned must differ from original when both are known
  CONSTRAINT adjudicator_rotation_check
    CHECK (
      original_adjudicator_id IS NULL
      OR assigned_adjudicator_id IS NULL
      OR original_adjudicator_id <> assigned_adjudicator_id
    )
);

CREATE INDEX IF NOT EXISTS idx_recon_practice_status
  ON cdcp_reconsiderations(practice_id, status);

CREATE INDEX IF NOT EXISTS idx_recon_deadline
  ON cdcp_reconsiderations(deadline_date)
  WHERE status IN ('eligible', 'urgent');

-- ─── CDAnet Attachment Records ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cdanet_attachments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reconsideration_id   UUID NOT NULL REFERENCES cdcp_reconsiderations(id),
  claim_id             VARCHAR(100) NOT NULL,
  practice_id          UUID NOT NULL REFERENCES practices(id),
  transaction_type     CHAR(2) NOT NULL DEFAULT '09',
  cdanet_version       VARCHAR(5) NOT NULL DEFAULT '04',
  itrans_version       VARCHAR(5) NOT NULL DEFAULT '2.0',
  total_size_bytes     INTEGER NOT NULL,
  checksum_sha256      CHAR(64) NOT NULL,
  attachment_files_json JSONB NOT NULL,  -- array of AttachmentFile (no base64 data)
  encryption_key_id    VARCHAR(100),
  submitted_at         TIMESTAMPTZ,
  confirmation_number  VARCHAR(100),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Phase 5 KPI Snapshots ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS phase5_kpi_snapshots (
  id                                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id                       UUID NOT NULL REFERENCES practices(id),
  snapshot_date                     DATE NOT NULL,
  reconsideration_success_rate      DECIMAL(5,2),  -- %
  ivr_navigation_success_rate       DECIMAL(5,2),
  authentication_success_rate       DECIMAL(5,2),
  status_retrieval_accuracy         DECIMAL(5,2),
  denial_taxonomy_mapping_accuracy  DECIMAL(5,2),
  zero_hallucination_rate           DECIMAL(5,2),
  disclosure_compliance_rate        DECIMAL(5,2),
  median_call_duration_seconds      INTEGER,       -- target < 720
  total_calls                       INTEGER,
  total_reconsidered                INTEGER,
  total_approved                    INTEGER,
  total_denied_final                INTEGER,
  created_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(practice_id, snapshot_date)
);

-- ─── Province Fee Guide 2026 ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS provincial_fee_guides (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  province_code             CHAR(2) NOT NULL,
  province_name             VARCHAR(100) NOT NULL,
  guide_year                SMALLINT NOT NULL,
  increment_pct             DECIMAL(5,2) NOT NULL,
  multiplier                DECIMAL(7,5) NOT NULL,
  cdcp_reimbursement_pct    DECIMAL(5,2) NOT NULL,
  cdcp_ceiling_multiplier   DECIMAL(7,5) NOT NULL,
  effective_date            DATE NOT NULL,
  notes                     TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(province_code, guide_year)
);

-- Seed 2026 fee guide data
INSERT INTO provincial_fee_guides
  (province_code, province_name, guide_year, increment_pct, multiplier, cdcp_reimbursement_pct, cdcp_ceiling_multiplier, effective_date, notes)
VALUES
  ('AB', 'Alberta',          2026, 4.50, 1.04500, 90.00, 0.94050, '2026-01-01', 'Alberta Dental Association 2026. Highest increment this cycle.'),
  ('ON', 'Ontario',          2026, 3.32, 1.03320, 90.00, 0.92988, '2026-01-01', 'Ontario Dental Association 2026.'),
  ('BC', 'British Columbia', 2026, 2.66, 1.02660, 88.00, 0.90341, '2026-01-01', 'BC Dental Association 2026. Lower CDCP ceiling than other provinces.'),
  ('QC', 'Quebec',           2026, 3.00, 1.03000, 90.00, 0.92700, '2026-01-01', 'OAQ 2026 - verify final increment when published.'),
  ('MB', 'Manitoba',         2026, 3.00, 1.03000, 90.00, 0.92700, '2026-01-01', 'MDA 2026.'),
  ('SK', 'Saskatchewan',     2026, 3.00, 1.03000, 90.00, 0.92700, '2026-01-01', 'SDA 2026.')
ON CONFLICT (province_code, guide_year) DO UPDATE SET
  increment_pct = EXCLUDED.increment_pct,
  multiplier = EXCLUDED.multiplier,
  cdcp_reimbursement_pct = EXCLUDED.cdcp_reimbursement_pct,
  cdcp_ceiling_multiplier = EXCLUDED.cdcp_ceiling_multiplier,
  notes = EXCLUDED.notes;

-- ─── Helpful view: urgent reconsiderations ────────────────────────────────────

CREATE OR REPLACE VIEW v_urgent_reconsiderations AS
SELECT
  r.id,
  r.claim_id,
  r.practice_id,
  r.denial_date,
  r.deadline_date,
  (r.deadline_date - CURRENT_DATE) AS days_remaining,
  r.status,
  r.denial_reason_code,
  d.cdt_code,
  d.province,
  d.procedure_fee_cents
FROM cdcp_reconsiderations r
JOIN cdcp_denied_claims d ON d.claim_id = r.claim_id
WHERE
  r.status IN ('eligible', 'urgent')
  AND r.deadline_date >= CURRENT_DATE
ORDER BY days_remaining ASC;

COMMENT ON VIEW v_urgent_reconsiderations IS
  'Shows all open CDCP reconsiderations ordered by deadline. Any claim with days_remaining <= 15 should be treated as urgent.';

COMMIT;
