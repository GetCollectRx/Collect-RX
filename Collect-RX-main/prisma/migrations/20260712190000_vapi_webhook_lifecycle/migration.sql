-- Durable, payload-free lifecycle for Vapi webhook deliveries.
-- Existing rows were already fully handled by the old insert-before-process
-- implementation, so mark them processed during the expand migration.
ALTER TABLE "ProcessedVapiWebhook"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'received',
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "processingStartedAt" TIMESTAMP(3),
  ADD COLUMN "processedAt" TIMESTAMP(3),
  ADD COLUMN "failedAt" TIMESTAMP(3);

UPDATE "ProcessedVapiWebhook"
SET
  "status" = 'processed',
  "attemptCount" = 1,
  "processedAt" = "createdAt";

CREATE INDEX "ProcessedVapiWebhook_status_createdAt_idx"
  ON "ProcessedVapiWebhook"("status", "createdAt");

COMMENT ON TABLE "ProcessedVapiWebhook" IS
  'Vapi webhook delivery ledger: SHA-256 body hash and lifecycle only; no raw payload or PHI. Global by design, so it is not tenant-RLS scoped.';
