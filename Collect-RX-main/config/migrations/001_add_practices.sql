-- CollectRx Migration 001 — Add practices table and wire practice_id onto claims
-- Run this ONCE against your existing database.
-- Safe to run multiple times (uses IF NOT EXISTS / IF NOT EXISTS guards).

-- ─── Practices ────────────────────────────────────────────────────────────────
-- Each row is one dental practice that has subscribed to CollectRx.
-- Practice config moves out of .env and into the DB so multi-practice works.

CREATE TABLE IF NOT EXISTS practices (
  id                      SERIAL PRIMARY KEY,
  name                    VARCHAR(200) NOT NULL,
  status                  VARCHAR(20) NOT NULL DEFAULT 'active',  -- active | inactive | suspended

  -- AbelDent integration
  abeldent_id             VARCHAR(50),                            -- unique ID in their AbelDent system

  -- Contact & billing identity (used by AI agents on every call)
  phone                   VARCHAR(30),
  fax                     VARCHAR(30),
  email                   VARCHAR(200),
  address                 VARCHAR(300),

  -- Insurance identity fields (sent to carriers for authentication)
  npi                     VARCHAR(20),                            -- National Provider Identifier (used in US, some Canadian carriers accept it)
  tax_id                  VARCHAR(30),                            -- Practice tax/business number
  provider_id             VARCHAR(50),                            -- Primary carrier provider ID
  cdcp_provider_number    VARCHAR(50),                            -- CDCP-specific provider number

  -- Notification preferences
  escalation_webhook_url  VARCHAR(500),                           -- Slack / Teams / custom webhook for this practice's escalations
  escalation_email        VARCHAR(200),                           -- Email fallback for escalation alerts

  -- Operational settings (override global defaults per practice)
  min_claim_value         DECIMAL(10,2) DEFAULT 100.00,           -- Don't call about claims below this value
  min_days_outstanding    INTEGER DEFAULT 14,                     -- Don't call until claim is this old
  max_call_attempts       INTEGER DEFAULT 3,                      -- Max automated attempts before human escalation
  max_calls_per_run       INTEGER DEFAULT 20,                     -- Max calls to dispatch per queue run

  created_at              TIMESTAMP DEFAULT NOW(),
  updated_at              TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_practices_status ON practices(status);
CREATE INDEX IF NOT EXISTS idx_practices_abeldent ON practices(abeldent_id);

-- ─── Wire practice_id onto claims ─────────────────────────────────────────────
-- Adds the foreign key column if it doesn't already exist.
-- Existing claims get NULL (compatible — they belong to the "env-configured" practice).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'claims' AND column_name = 'practice_id'
  ) THEN
    ALTER TABLE claims ADD COLUMN practice_id INTEGER REFERENCES practices(id);
    CREATE INDEX IF NOT EXISTS idx_claims_practice ON claims(practice_id);
    RAISE NOTICE 'Added practice_id column to claims.';
  ELSE
    RAISE NOTICE 'practice_id already exists on claims — skipping.';
  END IF;
END $$;

-- ─── Seed: create a default practice from env vars ────────────────────────────
-- After running this migration, manually UPDATE this row with real values,
-- OR delete it and insert via the API.
-- This prevents breaking existing claims that have no practice_id.

INSERT INTO practices (
  name,
  status,
  phone,
  npi,
  tax_id,
  provider_id,
  cdcp_provider_number,
  min_claim_value,
  min_days_outstanding,
  max_call_attempts,
  max_calls_per_run
)
SELECT
  'Default Practice',
  'active',
  '',      -- fill in: PRACTICE_PHONE
  '',      -- fill in: PRACTICE_NPI
  '',      -- fill in: PRACTICE_TAX_ID
  '',      -- fill in: PRACTICE_PROVIDER_ID
  '',      -- fill in: PRACTICE_CDCP_PROVIDER_NUMBER
  100.00,
  14,
  3,
  20
WHERE NOT EXISTS (SELECT 1 FROM practices WHERE name = 'Default Practice');
