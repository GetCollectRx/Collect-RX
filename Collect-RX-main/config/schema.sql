-- CollectRx Database Schema
-- Run this to initialize your PostgreSQL database

-- Claims table (imported from AbelDent CSV export)
CREATE TABLE IF NOT EXISTS claims (
  id                  VARCHAR(20) PRIMARY KEY,
  patient_first_name  VARCHAR(100) NOT NULL,
  patient_last_name   VARCHAR(100) NOT NULL,
  carrier_code        VARCHAR(20) NOT NULL,
  carrier_name        VARCHAR(100) NOT NULL,
  policy_number       VARCHAR(50) NOT NULL,
  procedure_code      VARCHAR(10) NOT NULL,
  procedure_description VARCHAR(200),
  amount_billed       DECIMAL(10,2) NOT NULL,
  amount_outstanding  DECIMAL(10,2) NOT NULL,
  submission_date     DATE NOT NULL,
  days_outstanding    INTEGER NOT NULL,
  aging_bucket        VARCHAR(10) NOT NULL,   -- '0-29', '30-59', '60-89', '90-119', '120+'
  status              VARCHAR(50) NOT NULL DEFAULT 'Pending',
  denial_reason       VARCHAR(200),
  escalation_flag     VARCHAR(50),            -- 'xray_required', etc.
  queue_status        VARCHAR(30) NOT NULL DEFAULT 'queued', -- queued | in_progress | resolved | escalated | paused | max_attempts
  call_attempts       INTEGER NOT NULL DEFAULT 0,
  last_called_at      TIMESTAMP,
  next_call_at        TIMESTAMP,
  resolved_at         TIMESTAMP,
  resolution_type     VARCHAR(50),            -- 'processing', 'resubmitted', 'patient_receivable', 'paid', 'escalated'
  priority_score      DECIMAL(6,2),
  notes               TEXT,
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW()
);

-- Call attempts log - every call the agent makes
CREATE TABLE IF NOT EXISTS call_attempts (
  id                  SERIAL PRIMARY KEY,
  claim_id            VARCHAR(20) NOT NULL REFERENCES claims(id),
  vapi_call_id        VARCHAR(100),           -- Vapi's call ID for reference
  carrier_code        VARCHAR(20) NOT NULL,
  carrier_name        VARCHAR(100) NOT NULL,
  started_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  ended_at            TIMESTAMP,
  duration_seconds    INTEGER,
  status              VARCHAR(30) NOT NULL DEFAULT 'initiated', -- initiated | connected | completed | failed | no_answer
  outcome_code        VARCHAR(50),            -- see outcome processor for codes
  outcome_summary     TEXT,
  transcript          TEXT,
  escalation_required BOOLEAN DEFAULT FALSE,
  escalation_reason   VARCHAR(200),
  next_action         VARCHAR(100),
  created_at          TIMESTAMP DEFAULT NOW()
);

-- Escalations - items flagged for human review
CREATE TABLE IF NOT EXISTS escalations (
  id                  SERIAL PRIMARY KEY,
  claim_id            VARCHAR(20) NOT NULL REFERENCES claims(id),
  call_attempt_id     INTEGER REFERENCES call_attempts(id),
  reason              VARCHAR(200) NOT NULL,  -- 'xray_required', 'max_attempts', 'unknown_response', 'appeal_required'
  details             TEXT,
  status              VARCHAR(20) NOT NULL DEFAULT 'open', -- open | acknowledged | resolved
  assigned_to         VARCHAR(100),
  resolved_at         TIMESTAMP,
  resolution_notes    TEXT,
  created_at          TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_claims_queue_status ON claims(queue_status);
CREATE INDEX IF NOT EXISTS idx_claims_carrier ON claims(carrier_code);
CREATE INDEX IF NOT EXISTS idx_claims_aging ON claims(aging_bucket);
CREATE INDEX IF NOT EXISTS idx_claims_next_call ON claims(next_call_at);
CREATE INDEX IF NOT EXISTS idx_call_attempts_claim ON call_attempts(claim_id);
CREATE INDEX IF NOT EXISTS idx_escalations_status ON escalations(status);
