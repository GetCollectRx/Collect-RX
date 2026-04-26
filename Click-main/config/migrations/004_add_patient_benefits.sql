-- Migration 004: Patient Benefits & Eligibility
-- Stores benefit data from eligibility calls, enables pre-treatment estimates.

-- ─── Patient benefits summary (per carrier, per plan year) ─────────────────────

CREATE TABLE IF NOT EXISTS patient_benefits (
  id                  SERIAL PRIMARY KEY,
  patient_token       UUID          NOT NULL,
  carrier_code        VARCHAR(50)   NOT NULL,
  plan_year           VARCHAR(10)   NOT NULL,      -- e.g., "2026" or "2026-2027"
  annual_max          DECIMAL(10,2),               -- total annual maximum
  annual_max_used     DECIMAL(10,2) NOT NULL DEFAULT 0,  -- includes pending claims
  deductible          DECIMAL(10,2) NOT NULL DEFAULT 0,
  deductible_met      DECIMAL(10,2) NOT NULL DEFAULT 0,
  stale_flag          BOOLEAN       NOT NULL DEFAULT FALSE,  -- practice can flag for refresh
  last_verified_at    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE(patient_token, carrier_code, plan_year)
);

CREATE INDEX IF NOT EXISTS idx_patient_benefits_token ON patient_benefits (patient_token);
CREATE INDEX IF NOT EXISTS idx_patient_benefits_carrier ON patient_benefits (carrier_code);

-- ─── Coverage by CDT category ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS benefit_coverage (
  id                    SERIAL PRIMARY KEY,
  patient_token         UUID          NOT NULL,
  carrier_code          VARCHAR(50)   NOT NULL,
  cdt_category          VARCHAR(50)   NOT NULL,
    -- preventive, basic_restorative, major_restorative, endodontics,
    -- periodontics, prosthodontics, oral_surgery, orthodontics
  coverage_pct          DECIMAL(5,2)  NOT NULL,           -- e.g., 80.00 for 80%
  waiting_period_months INTEGER       NOT NULL DEFAULT 0,
  waiting_period_start  DATE,                             -- enrollment or effective date
  frequency_limit_months INTEGER,                         -- null = no limit
  last_service_date     DATE,                             -- for frequency tracking
  last_verified_at      TIMESTAMPTZ,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE(patient_token, carrier_code, cdt_category)
);

CREATE INDEX IF NOT EXISTS idx_benefit_coverage_token ON benefit_coverage (patient_token);

-- ─── Plan year dates (anniversary-based, not always Jan 1) ─────────────────────

CREATE TABLE IF NOT EXISTS plan_years (
  id                SERIAL PRIMARY KEY,
  patient_token     UUID        NOT NULL,
  carrier_code      VARCHAR(50) NOT NULL,
  plan_year_start   DATE        NOT NULL,
  plan_year_end     DATE        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(patient_token, carrier_code, plan_year_start)
);

CREATE INDEX IF NOT EXISTS idx_plan_years_token ON plan_years (patient_token);

-- ─── Eligibility call attempts log ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS eligibility_calls (
  id                SERIAL PRIMARY KEY,
  patient_token     UUID          NOT NULL,
  carrier_code      VARCHAR(50)   NOT NULL,
  vapi_call_id      VARCHAR(100),
  status            VARCHAR(30)   NOT NULL DEFAULT 'initiated',
    -- initiated | completed | failed
  outcome           JSONB,                 -- parsed benefit data from call
  transcript        TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eligibility_calls_token ON eligibility_calls (patient_token);
