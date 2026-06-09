-- ─────────────────────────────────────────────────────────────────────────────
-- CollectRx — Plan / monetization layer  (P0)
--
-- Source: collectrx-tiering-strategy.md §7. Without these tables, no part of
-- the tiering strategy ships: trials don't pause, paid limits aren't enforced,
-- the upgrade prompt has no state to read.
--
-- Apply on Railway:
--     psql $DATABASE_URL -f migrations/plans-schema.sql
--
-- Idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Enums ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE plan_tier AS ENUM ('basic', 'professional', 'enterprise');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE plan_status AS ENUM ('trial', 'active', 'past_due', 'canceled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE usage_event_type AS ENUM (
    'resolved_status_call',
    'resolved_claim',
    'recovered_dollars'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── plans ────────────────────────────────────────────────────────────────────
-- One row per practice. PK = practice_id (1:1 with Practice).
CREATE TABLE IF NOT EXISTS plans (
  practice_id            TEXT         PRIMARY KEY,
  tier                   plan_tier    NOT NULL DEFAULT 'professional',
  status                 plan_status  NOT NULL DEFAULT 'trial',

  -- Outcome-gated trial (§3.1): full Pro features until trial_recovered_cents
  -- reaches trial_threshold_cents (default $2,500 = 250_000).
  trial_recovered_cents  BIGINT       NOT NULL DEFAULT 0,
  trial_threshold_cents  BIGINT       NOT NULL DEFAULT 250000,
  trial_started_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  trial_converted_at     TIMESTAMPTZ,

  -- Billing-cycle counters (reset by usageService.startNewCycle()).
  cycle_started_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  status_calls_used      INTEGER      NOT NULL DEFAULT 0 CHECK (status_calls_used >= 0),
  resolved_claims_used   INTEGER      NOT NULL DEFAULT 0 CHECK (resolved_claims_used >= 0),

  -- Lifetime total (survives cycle resets) — used for Enterprise %-of-recovery.
  recovered_cents_total  BIGINT       NOT NULL DEFAULT 0 CHECK (recovered_cents_total >= 0),

  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE plans IS
  'One row per practice. Drives planService.canMakeCall and usageService.recordOutcome.';
COMMENT ON COLUMN plans.trial_recovered_cents IS
  'Cents recovered during outcome-gated trial. Trial pauses once >= trial_threshold_cents.';
COMMENT ON COLUMN plans.recovered_cents_total IS
  'Lifetime recovered cents. Distinct from trial_recovered_cents — survives conversion.';

-- ── usage_events ─────────────────────────────────────────────────────────────
-- One row per terminal, value-bearing call outcome.
-- vapi_call_id UNIQUE → webhook redelivery is a no-op.
CREATE TABLE IF NOT EXISTS usage_events (
  id            UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id   TEXT              NOT NULL,
  claim_id      TEXT,
  vapi_call_id  TEXT              UNIQUE,
  event_type    usage_event_type  NOT NULL,
  amount_cents  BIGINT            NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  occurred_at   TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  metadata      JSONB
);

CREATE INDEX IF NOT EXISTS idx_usage_events_practice_time
  ON usage_events (practice_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_type
  ON usage_events (event_type);

COMMENT ON TABLE usage_events IS
  'Per-call usage log. vapi_call_id UNIQUE enforces webhook idempotency.';

-- ── updated_at trigger on plans ──────────────────────────────────────────────
-- Reuses update_updated_at_column() from insurance-schema.sql when present.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    DROP TRIGGER IF EXISTS trg_plans_updated_at ON plans;
    CREATE TRIGGER trg_plans_updated_at
      BEFORE UPDATE ON plans
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
