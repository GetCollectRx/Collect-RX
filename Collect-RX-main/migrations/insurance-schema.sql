-- ─────────────────────────────────────────────────────────────────────────────
-- CollectRx — Phase 5 Insurance / Voice-AI Backend Schema Migration
-- PostgreSQL (Railway)
--
-- Run:
--   psql $DATABASE_URL -f migrations/insurance-schema.sql
--
-- Tables:
--   1. insurance_claims     — core claim record (patientToken only — no PHI)
--   2. call_attempts        — one row per Vapi call (idempotent on vapi_call_id)
--   3. carrier_block_events — automation-detection events, practice-wide suspension
--   4. call_queue           — scheduling, retry tracking, priority queue
--
-- SAFETY INVARIANTS (enforced by schema):
--   • patient_token is a UUID — never a real patient identifier
--   • carrier_block_events: NULL resumed_at = active block (query before dispatch)
--   • call_attempts: vapi_call_id UNIQUE — prevents duplicate webhook processing
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE claim_status AS ENUM (
    'PENDING', 'IN_QUEUE', 'CALLING', 'APPROVED_PENDING_PAYMENT', 'RESOLVED',
    'DENIED', 'ESCALATED', 'ON_HOLD', 'BLOCKED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE claim_priority AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE call_outcome AS ENUM (
    'RESOLVED', 'PENDING', 'DENIED', 'ESCALATED',
    'BLOCK_DETECTED', 'FAILED', 'NO_ANSWER', 'HUNG_UP'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE queue_status AS ENUM (
    'PENDING', 'IN_PROGRESS', 'COMPLETED', 'ESCALATED', 'BLOCKED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- carrier_id enum already created by eligibility-schema.sql — guard with IF NOT EXISTS
DO $$ BEGIN
  CREATE TYPE carrier_id AS ENUM (
    'sun_life', 'canada_life', 'manulife', 'green_shield', 'rbc', 'telus_adjudicare'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. insurance_claims
--    Core claim record. patient_token is a UUID referencing PIIVault.
--    patientToken is the ONLY patient identifier stored here — no names, DOBs,
--    or health card numbers.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS insurance_claims (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id        TEXT         NOT NULL,
  carrier_id         carrier_id   NOT NULL,
  claim_number       TEXT         NOT NULL,
  -- UUID issued by PIIVault. NEVER store real patient identifiers here.
  patient_token      UUID         NOT NULL,
  billed_amount      NUMERIC(10,2) NOT NULL CHECK (billed_amount >= 0),
  outstanding_amount NUMERIC(10,2) NOT NULL CHECK (outstanding_amount >= 0),
  days_outstanding   INTEGER      NOT NULL CHECK (days_outstanding >= 0),
  serviced_at        TIMESTAMPTZ  NULL,
  status             claim_status NOT NULL DEFAULT 'PENDING',
  priority           claim_priority NOT NULL DEFAULT 'NORMAL',
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  UNIQUE (practice_id, claim_number)
);

COMMENT ON TABLE insurance_claims IS
  'Core AR claim records. patient_token is a UUID from PIIVault — never store real patient PHI here.';
COMMENT ON COLUMN insurance_claims.patient_token IS
  'UUID from PIIVault. Detokenize only on the backend after call completion — never pass to Vapi.';

CREATE INDEX IF NOT EXISTS idx_claims_practice_carrier
  ON insurance_claims (practice_id, carrier_id);
CREATE INDEX IF NOT EXISTS idx_claims_practice_status
  ON insurance_claims (practice_id, status);
CREATE INDEX IF NOT EXISTS idx_claims_carrier_aging
  ON insurance_claims (carrier_id, days_outstanding DESC);
CREATE INDEX IF NOT EXISTS idx_claims_priority
  ON insurance_claims (priority, days_outstanding DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_insurance_claims_updated_at ON insurance_claims;
CREATE TRIGGER trg_insurance_claims_updated_at
  BEFORE UPDATE ON insurance_claims
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. call_attempts
--    One row per Vapi call attempt.
--    vapi_call_id UNIQUE enforces webhook idempotency — duplicate events are no-ops.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS call_attempts (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id              UUID         NOT NULL REFERENCES insurance_claims(id) ON DELETE CASCADE,
  -- UNIQUE: prevents processing the same Vapi webhook event twice.
  vapi_call_id          TEXT         NOT NULL UNIQUE,
  initiated_at          TIMESTAMPTZ  NOT NULL,
  completed_at          TIMESTAMPTZ,
  duration_seconds      INTEGER      CHECK (duration_seconds >= 0),
  outcome               call_outcome,
  outcome_detail        TEXT,
  rep_name              TEXT,
  reference_number      TEXT,
  transcript_url        TEXT,
  -- TRUE if this call triggered the CARRIER_BLOCK suspension protocol.
  carrier_block_detected BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE call_attempts IS
  'One row per Vapi voice call. vapi_call_id UNIQUE enforces webhook idempotency.';
COMMENT ON COLUMN call_attempts.carrier_block_detected IS
  'Set to TRUE when this call triggers the CARRIER_BLOCK protocol. Fires practice-wide suspension.';

CREATE INDEX IF NOT EXISTS idx_call_attempts_claim
  ON call_attempts (claim_id);
CREATE INDEX IF NOT EXISTS idx_call_attempts_outcome
  ON call_attempts (outcome);
CREATE INDEX IF NOT EXISTS idx_call_attempts_initiated
  ON call_attempts (initiated_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_attempts_block
  ON call_attempts (carrier_block_detected)
  WHERE carrier_block_detected = TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. carrier_block_events
--    Written when a carrier detects automation. resumed_at NULL = block still active.
--    Before dispatching ANY call: check for active block (resumed_at IS NULL).
--    This is the highest-risk operational event.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS carrier_block_events (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id  TEXT         NOT NULL,
  carrier_id   carrier_id   NOT NULL,
  blocked_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  -- NULL = block still active. Set when calls are manually resumed.
  resumed_at   TIMESTAMPTZ,
  resumed_by   TEXT,
  notes        TEXT
);

COMMENT ON TABLE carrier_block_events IS
  'Carrier automation-detection events. resumed_at IS NULL = block still active for that practice+carrier.';
COMMENT ON COLUMN carrier_block_events.resumed_at IS
  'NULL = block active. Set via POST /api/carriers/:id/unblock after investigation.';

CREATE INDEX IF NOT EXISTS idx_carrier_block_practice_carrier
  ON carrier_block_events (practice_id, carrier_id, blocked_at DESC);
-- Partial index for active blocks — used in CARRIER_BLOCK pre-dispatch check
CREATE INDEX IF NOT EXISTS idx_carrier_block_active
  ON carrier_block_events (practice_id, carrier_id)
  WHERE resumed_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. call_queue
--    One row per claim in queue. Tracks scheduling, retry count, priority.
--    CALL RULES (enforced by application layer — documented here for clarity):
--      - Calls only Mon–Fri 08:00–17:00 Eastern
--      - Max 3 attempts per claim (attempts >= 3 → no further dispatch)
--      - Claims < 30 days old → do not enqueue
--      - Claims > 90 days old → ESCALATED immediately, skip AI
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS call_queue (
  id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     TEXT           NOT NULL,
  claim_id        UUID           NOT NULL UNIQUE REFERENCES insurance_claims(id) ON DELETE CASCADE,
  scheduled_for   TIMESTAMPTZ    NOT NULL,
  priority        claim_priority NOT NULL DEFAULT 'NORMAL',
  -- Hard cap: 3. Application MUST check attempts < 3 before dispatching.
  attempts        INTEGER        NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_attempt_at TIMESTAMPTZ,
  status          queue_status   NOT NULL DEFAULT 'PENDING',
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE call_queue IS
  'Call scheduling queue. Max 3 attempts per claim. Check CARRIER_BLOCK before every dispatch.';
COMMENT ON COLUMN call_queue.attempts IS
  'Incremented on each dispatch. Hard cap 3 — never dispatch when attempts >= 3.';

CREATE INDEX IF NOT EXISTS idx_queue_practice_status
  ON call_queue (practice_id, status);
CREATE INDEX IF NOT EXISTS idx_queue_scheduled
  ON call_queue (scheduled_for ASC)
  WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_queue_priority
  ON call_queue (practice_id, priority DESC, scheduled_for ASC);

DROP TRIGGER IF EXISTS trg_call_queue_updated_at ON call_queue;
CREATE TRIGGER trg_call_queue_updated_at
  BEFORE UPDATE ON call_queue
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- VIEWS
-- ─────────────────────────────────────────────────────────────────────────────

-- Active queue: claims ready to call right now (PENDING, not blocked, under 3 attempts)
CREATE OR REPLACE VIEW v_active_queue AS
SELECT
  q.id             AS queue_id,
  q.practice_id,
  q.claim_id,
  q.scheduled_for,
  q.priority,
  q.attempts,
  q.last_attempt_at,
  c.carrier_id,
  c.claim_number,
  c.outstanding_amount,
  c.days_outstanding
FROM call_queue q
JOIN insurance_claims c ON c.id = q.claim_id
WHERE q.status = 'PENDING'
  AND q.attempts < 3
  AND NOT EXISTS (
    SELECT 1 FROM carrier_block_events b
    WHERE b.practice_id = q.practice_id
      AND b.carrier_id  = c.carrier_id
      AND b.resumed_at IS NULL
  )
ORDER BY q.priority DESC, q.scheduled_for ASC;

COMMENT ON VIEW v_active_queue IS
  'Claims ready to dispatch: PENDING, under 3 attempts, carrier not blocked.';

-- Per-carrier block status for the health endpoint
CREATE OR REPLACE VIEW v_carrier_block_status AS
SELECT
  practice_id,
  carrier_id,
  COUNT(*) FILTER (WHERE resumed_at IS NULL) > 0 AS is_blocked,
  MAX(blocked_at) FILTER (WHERE resumed_at IS NULL) AS blocked_since
FROM carrier_block_events
GROUP BY practice_id, carrier_id;

COMMENT ON VIEW v_carrier_block_status IS
  'Current block status per practice+carrier. is_blocked=true means calls are suspended.';

-- ─── Idempotent upgrades (older DBs) — same as prisma/migrations/20260511120000_* ─────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'claim_status' AND e.enumlabel = 'APPROVED_PENDING_PAYMENT'
  ) THEN
    ALTER TYPE claim_status ADD VALUE 'APPROVED_PENDING_PAYMENT';
  END IF;
END $$;

ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS serviced_at TIMESTAMPTZ NULL;
