-- Tenant-safe, tamper-evident AuditLog chaining for the configured retention window.
-- This deliberately does not block the authorized retention job's DELETEs and
-- is not represented as WORM storage. Application code exposes inserts and
-- verification only; stronger role separation/external WORM remains a launch gate.
ALTER TABLE "AuditLog"
  ADD COLUMN IF NOT EXISTS "previous_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "integrity_hash" TEXT;

CREATE INDEX IF NOT EXISTS "AuditLog_practiceId_integrityHash_idx"
  ON "AuditLog" ("practiceId", "integrity_hash");

COMMENT ON COLUMN "AuditLog"."previous_hash" IS
  'Previous retained tenant-chain hash; first retained row may anchor to a hash removed by authorized retention.';
COMMENT ON COLUMN "AuditLog"."integrity_hash" IS
  'SHA-256 integrity digest computed under a per-tenant transaction advisory lock; tamper-evident, not WORM.';
