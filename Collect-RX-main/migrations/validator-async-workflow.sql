-- Validator Async Workflow Migration
-- Adds tables and columns for async validator webhook + practice notifications

-- 1. Table for idempotent validator webhook processing
CREATE TABLE IF NOT EXISTS "ProcessedValidatorWebhook" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "bodyHash" TEXT NOT NULL UNIQUE,
  "processedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "ProcessedValidatorWebhook_bodyHash_idx" ON "ProcessedValidatorWebhook"("bodyHash");

-- 2. Add validation fields to CallAttempt
ALTER TABLE "CallAttempt"
  ADD COLUMN IF NOT EXISTS "validationPassed" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "validationResult" JSONB;

-- 3. Table for practice notifications (dashboard visibility)
CREATE TABLE IF NOT EXISTS "PracticeNotification" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "practiceId" TEXT NOT NULL,
  "type" TEXT NOT NULL, -- VALIDATION_ESCALATION, CARRIER_BLOCK, PAYMENT_RECEIVED, CLAIM_DENIED
  "subject" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "claimId" TEXT,
  "severity" TEXT NOT NULL DEFAULT 'info', -- info, warning, critical
  "readAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PracticeNotification_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES practice("id") ON DELETE CASCADE,
  CONSTRAINT "PracticeNotification_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES insurance_claims("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "PracticeNotification_practiceId_idx" ON "PracticeNotification"("practiceId");
CREATE INDEX IF NOT EXISTS "PracticeNotification_claimId_idx" ON "PracticeNotification"("claimId");
CREATE INDEX IF NOT EXISTS "PracticeNotification_readAt_idx" ON "PracticeNotification"("readAt");
CREATE INDEX IF NOT EXISTS "PracticeNotification_createdAt_idx" ON "PracticeNotification"("createdAt");
