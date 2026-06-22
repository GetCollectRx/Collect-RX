/*
  Warnings:

  - The primary key for the `emr_sync_outbox` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the `Balance` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `BalanceState` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `OutreachEvent` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Patient` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PatientBalance` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PaymentEvent` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `StripeConnectAccount` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Balance" DROP CONSTRAINT "Balance_patientId_fkey";

-- DropForeignKey
ALTER TABLE "Balance" DROP CONSTRAINT "Balance_practiceId_fkey";

-- DropForeignKey
ALTER TABLE "BalanceState" DROP CONSTRAINT "BalanceState_balanceId_fkey";

-- DropForeignKey
ALTER TABLE "OutreachEvent" DROP CONSTRAINT "OutreachEvent_balanceId_fkey";

-- DropForeignKey
ALTER TABLE "Patient" DROP CONSTRAINT "Patient_practiceId_fkey";

-- DropForeignKey
ALTER TABLE "PaymentEvent" DROP CONSTRAINT "PaymentEvent_balanceId_fkey";

-- DropIndex
DROP INDEX "AuditLog_createdAt_idx";

-- DropIndex
DROP INDEX "AuditLog_practiceId_createdAt_idx";

-- DropIndex
DROP INDEX "call_attempts_eval_completed_at_idx";

-- AlterTable
ALTER TABLE "Practice" ADD COLUMN     "address" TEXT,
ADD COLUMN     "billing_phone" TEXT,
ADD COLUMN     "fax_number" TEXT,
ADD COLUMN     "npi" TEXT,
ADD COLUMN     "tax_id" TEXT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "tokenExpiresAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "call_queue" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "claim_recovery_actions" ALTER COLUMN "scheduled_recall_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "cleared_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "claim_recovery_events" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "emr_sync_outbox" DROP CONSTRAINT "emr_sync_outbox_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "processed_at" SET DATA TYPE TIMESTAMP(3),
ADD CONSTRAINT "emr_sync_outbox_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "insurance_claims" ADD COLUMN     "expected_amount" DECIMAL(10,2),
ADD COLUMN     "submitted_at" TIMESTAMP(3),
ADD COLUMN     "treatment_codes" TEXT,
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "payment_expected_by" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "insurance_plans" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "phi_vault_entries" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "expires_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "reconciliation_logs" ALTER COLUMN "variance_reasons" DROP DEFAULT,
ALTER COLUMN "raw_adjudication_json" DROP DEFAULT;

-- DropTable
DROP TABLE "Balance";

-- DropTable
DROP TABLE "BalanceState";

-- DropTable
DROP TABLE "OutreachEvent";

-- DropTable
DROP TABLE "Patient";

-- DropTable
DROP TABLE "PatientBalance";

-- DropTable
DROP TABLE "PaymentEvent";

-- DropTable
DROP TABLE "StripeConnectAccount";

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_token_idx" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "AuditLog_practiceId_createdAt_idx" ON "AuditLog"("practiceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- RenameIndex
ALTER INDEX "claim_recovery_actions_trace_due_idx" RENAME TO "claim_recovery_actions_action_type_status_scheduled_recall__idx";

-- RenameIndex
ALTER INDEX "eligibility_snapshots_practice_id_patient_id_carrier_verified_a" RENAME TO "eligibility_snapshots_practice_id_patient_id_carrier_verifi_idx";

-- RenameIndex
ALTER INDEX "idx_emr_sync_outbox_claim" RENAME TO "emr_sync_outbox_claim_id_idx";

-- RenameIndex
ALTER INDEX "idx_emr_sync_outbox_practice_created" RENAME TO "emr_sync_outbox_practice_id_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_emr_sync_outbox_processed" RENAME TO "emr_sync_outbox_processed_at_idx";
