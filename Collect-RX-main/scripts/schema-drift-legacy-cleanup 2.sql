/**
 * Idempotent legacy patient-layer cleanup for Railway schema drift.
 * Safe to re-run. Only drops tables Prisma no longer models.
 *
 * Run via: npm run db:apply-schema-drift
 */
-- Legacy patient-layer tables (removed from Prisma schema)
DROP TABLE IF EXISTS "PaymentEvent" CASCADE;
DROP TABLE IF EXISTS "OutreachEvent" CASCADE;
DROP TABLE IF EXISTS "BalanceState" CASCADE;
DROP TABLE IF EXISTS "PatientBalance" CASCADE;
DROP TABLE IF EXISTS "Balance" CASCADE;
DROP TABLE IF EXISTS "Patient" CASCADE;
DROP TABLE IF EXISTS "StripeConnectAccount" CASCADE;

-- Practice columns that may be missing on older Railway DBs
ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "address" TEXT;
ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "billing_phone" TEXT;
ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "fax_number" TEXT;
ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "npi" TEXT;
ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "tax_id" TEXT;

-- Insurance claim columns from recovery pipeline
ALTER TABLE "insurance_claims" ADD COLUMN IF NOT EXISTS "expected_amount" DECIMAL(10,2);
ALTER TABLE "insurance_claims" ADD COLUMN IF NOT EXISTS "submitted_at" TIMESTAMP(3);
ALTER TABLE "insurance_claims" ADD COLUMN IF NOT EXISTS "treatment_codes" TEXT;

-- Password reset tokens (if not yet created)
CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PasswordResetToken_token_key" ON "PasswordResetToken"("token");
CREATE INDEX IF NOT EXISTS "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
CREATE INDEX IF NOT EXISTS "PasswordResetToken_token_idx" ON "PasswordResetToken"("token");
