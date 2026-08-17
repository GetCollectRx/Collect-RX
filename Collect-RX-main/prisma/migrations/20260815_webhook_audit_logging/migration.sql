-- WebhookAuditLog: comprehensive webhook validation and processing audit trail
-- Tracks all webhook attempts: signature validation, timestamp verification, idempotency, and outcomes
CREATE TABLE "webhook_audit_logs" (
  id                   TEXT    NOT NULL PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  webhook_type         TEXT    NOT NULL,
  webhook_id           TEXT    NOT NULL,
  signature_valid      BOOLEAN NOT NULL,
  timestamp_valid      BOOLEAN NOT NULL DEFAULT true,
  idempotency_check    TEXT    NOT NULL,
  error_message        TEXT,
  http_status_code     INTEGER,
  source_ip            TEXT,
  request_headers      JSONB,
  received_at          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at         TIMESTAMP(3),
  created_at           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_webhook_audit_logs_type ON "webhook_audit_logs"("webhook_type");
CREATE INDEX idx_webhook_audit_logs_webhook_id ON "webhook_audit_logs"("webhook_id");
CREATE INDEX idx_webhook_audit_logs_signature_valid ON "webhook_audit_logs"("signature_valid");
CREATE INDEX idx_webhook_audit_logs_created_at ON "webhook_audit_logs"("created_at" DESC);
CREATE INDEX idx_webhook_audit_logs_type_created ON "webhook_audit_logs"("webhook_type", "created_at" DESC);
