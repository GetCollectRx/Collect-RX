-- Migration 003: Patient AR tables
-- Stores post-insurance patient balances, tracks reminder lifecycle,
-- and links practices to their Stripe Connect merchant accounts.

-- ─── Patient balances ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS patient_balances (
  id                        SERIAL PRIMARY KEY,
  patient_token             UUID         NOT NULL DEFAULT gen_random_uuid(),
  abeldent_patient_id       VARCHAR(20),
  patient_first_name        VARCHAR(100) NOT NULL,
  patient_last_name         VARCHAR(100) NOT NULL,
  patient_email             VARCHAR(254),
  patient_phone             VARCHAR(30),
  procedure_code            VARCHAR(20),
  procedure_description     VARCHAR(200),
  treatment_date            DATE,
  adjudication_date         DATE,           -- insurance paid/denied date; AR clock starts here
  amount_billed             DECIMAL(10,2) NOT NULL,
  insurance_paid            DECIMAL(10,2) NOT NULL DEFAULT 0,
  patient_owes              DECIMAL(10,2) NOT NULL,
  days_since_adjudication   INTEGER       NOT NULL DEFAULT 0,
  practice_id               INTEGER       REFERENCES practices(id),

  -- Reminder lifecycle
  reminder_status           VARCHAR(30)   NOT NULL DEFAULT 'none',
    -- none | reminder_1 | reminder_2 | reminder_3

  -- Payment lifecycle
  payment_status            VARCHAR(30)   NOT NULL DEFAULT 'outstanding',
    -- outstanding | partial | paid | written_off

  amount_paid               DECIMAL(10,2) NOT NULL DEFAULT 0,

  -- Stripe
  stripe_payment_link       VARCHAR(500),         -- URL sent to patient
  stripe_payment_link_id    VARCHAR(100),         -- Stripe plink_xxx
  stripe_payment_intent_id  VARCHAR(100),         -- for reconciliation

  -- Reminder send timestamps (per-channel 7-day rate-limit window)
  last_reminder_email_at    TIMESTAMPTZ,
  last_reminder_sms_at      TIMESTAMPTZ,

  created_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Partial unique index for AbelDent dedup (only when we have the identifiers)
CREATE UNIQUE INDEX IF NOT EXISTS patient_balances_abeldent_dedup
  ON patient_balances (abeldent_patient_id, treatment_date, procedure_code, COALESCE(practice_id, 0))
  WHERE abeldent_patient_id IS NOT NULL
    AND treatment_date IS NOT NULL
    AND procedure_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pb_payment_status    ON patient_balances (payment_status);
CREATE INDEX IF NOT EXISTS idx_pb_reminder_status   ON patient_balances (reminder_status);
CREATE INDEX IF NOT EXISTS idx_pb_adjudication_date ON patient_balances (adjudication_date);
CREATE INDEX IF NOT EXISTS idx_pb_patient_token     ON patient_balances (patient_token);
CREATE INDEX IF NOT EXISTS idx_pb_practice          ON patient_balances (practice_id);

-- ─── Stripe Connect accounts ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stripe_connect_accounts (
  id                  SERIAL PRIMARY KEY,
  practice_id         INTEGER       NOT NULL REFERENCES practices(id) UNIQUE,
  stripe_account_id   VARCHAR(100)  NOT NULL UNIQUE,     -- acct_xxx
  onboarding_complete BOOLEAN       NOT NULL DEFAULT FALSE,
  charges_enabled     BOOLEAN       NOT NULL DEFAULT FALSE,
  payouts_enabled     BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
