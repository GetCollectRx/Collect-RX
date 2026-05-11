CREATE TABLE IF NOT EXISTS emr_sync_outbox (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  practice_id   TEXT NOT NULL,
  claim_id      TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  payload_json  JSONB NOT NULL,
  processed_at  TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_emr_sync_outbox_practice_created
  ON emr_sync_outbox (practice_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_emr_sync_outbox_claim
  ON emr_sync_outbox (claim_id);

CREATE INDEX IF NOT EXISTS idx_emr_sync_outbox_processed
  ON emr_sync_outbox (processed_at);

COMMENT ON TABLE emr_sync_outbox IS
  'Append-only queue for EMR/PMS sync — populated on claim resolution / payment confirmation; drained by connector worker.';
