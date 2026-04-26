-- Migration 002: Add queue_priority table
-- Stores which carrier the front desk has flagged as today's focus.
-- The queue engine reads this and boosts all claims from that carrier.

CREATE TABLE IF NOT EXISTS queue_priority (
  id              SERIAL PRIMARY KEY,
  carrier_code    VARCHAR(50)  NOT NULL,
  priority_date   DATE         NOT NULL DEFAULT CURRENT_DATE,
  set_by          VARCHAR(254),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- Only one priority per day; upsert on conflict
  CONSTRAINT queue_priority_date_unique UNIQUE (priority_date)
);

CREATE INDEX IF NOT EXISTS idx_queue_priority_date ON queue_priority (priority_date);
