-- CreateEnum
CREATE TYPE "PadMandateStatus" AS ENUM ('pending_authorization', 'active', 'suspended', 'canceled');

-- CreateEnum
CREATE TYPE "PadTransactionStatus" AS ENUM ('future', 'sent_to_bank', 'processed', 'approved', 'declined', 'chargeback');

-- AlterEnum
BEGIN;
CREATE TYPE "work_item_source_new" AS ENUM ('insurance_claim');
ALTER TABLE "work_items" ALTER COLUMN "source_type" TYPE "work_item_source_new" USING ("source_type"::text::"work_item_source_new");
ALTER TYPE "work_item_source" RENAME TO "work_item_source_old";
ALTER TYPE "work_item_source_new" RENAME TO "work_item_source";
DROP TYPE "work_item_source_old";
COMMIT;

-- DropIndex
DROP INDEX "triage_credentials_last_health_check_at_idx";

-- CreateTable
CREATE TABLE "ProcessedGoCardlessEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedGoCardlessEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pad_mandates" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "gocardless_billing_request_id" TEXT NOT NULL,
    "gocardless_customer_id" TEXT,
    "gocardless_mandate_id" TEXT,
    "gocardless_subscription_id" TEXT,
    "status" "PadMandateStatus" NOT NULL DEFAULT 'pending_authorization',
    "bank_account_last4" TEXT,
    "monthly_amount_cents" INTEGER NOT NULL,
    "pre_notification_days" INTEGER NOT NULL DEFAULT 3,
    "authorized_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pad_mandates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pad_transactions" (
    "id" TEXT NOT NULL,
    "mandate_id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "gocardless_payment_id" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "status" "PadTransactionStatus" NOT NULL DEFAULT 'future',
    "billing_period_start" TIMESTAMP(3) NOT NULL,
    "billing_period_end" TIMESTAMP(3) NOT NULL,
    "pre_notification_sent_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "settled_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pad_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phipa_deletion_requests" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "patient_token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "purged_claims_count" INTEGER NOT NULL DEFAULT 0,
    "purged_calls_count" INTEGER NOT NULL DEFAULT 0,
    "purged_recordings_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "phipa_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phipa_breach_notifications" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "notificationType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "notification_deadline" TIMESTAMP(3) NOT NULL,
    "notified_at" TIMESTAMP(3),
    "affected_patient_token" TEXT,
    "affected_records_count" INTEGER NOT NULL DEFAULT 0,
    "remediation_steps" TEXT,
    "remediation_completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phipa_breach_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pad_mandates_practice_id_key" ON "pad_mandates"("practice_id");

-- CreateIndex
CREATE UNIQUE INDEX "pad_mandates_gocardless_billing_request_id_key" ON "pad_mandates"("gocardless_billing_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "pad_mandates_gocardless_customer_id_key" ON "pad_mandates"("gocardless_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "pad_mandates_gocardless_mandate_id_key" ON "pad_mandates"("gocardless_mandate_id");

-- CreateIndex
CREATE UNIQUE INDEX "pad_mandates_gocardless_subscription_id_key" ON "pad_mandates"("gocardless_subscription_id");

-- CreateIndex
CREATE INDEX "pad_mandates_status_idx" ON "pad_mandates"("status");

-- CreateIndex
CREATE UNIQUE INDEX "pad_transactions_gocardless_payment_id_key" ON "pad_transactions"("gocardless_payment_id");

-- CreateIndex
CREATE INDEX "pad_transactions_practice_id_idx" ON "pad_transactions"("practice_id");

-- CreateIndex
CREATE INDEX "pad_transactions_status_idx" ON "pad_transactions"("status");

-- CreateIndex
CREATE INDEX "phipa_deletion_requests_practice_id_idx" ON "phipa_deletion_requests"("practice_id");

-- CreateIndex
CREATE INDEX "phipa_deletion_requests_patient_token_idx" ON "phipa_deletion_requests"("patient_token");

-- CreateIndex
CREATE INDEX "phipa_deletion_requests_status_idx" ON "phipa_deletion_requests"("status");

-- CreateIndex
CREATE INDEX "phipa_deletion_requests_created_at_idx" ON "phipa_deletion_requests"("created_at" DESC);

-- CreateIndex
CREATE INDEX "phipa_breach_notifications_practice_id_idx" ON "phipa_breach_notifications"("practice_id");

-- CreateIndex
CREATE INDEX "phipa_breach_notifications_notification_deadline_idx" ON "phipa_breach_notifications"("notification_deadline");

-- CreateIndex
CREATE INDEX "phipa_breach_notifications_notified_at_idx" ON "phipa_breach_notifications"("notified_at");

-- CreateIndex
CREATE INDEX "phipa_breach_notifications_created_at_idx" ON "phipa_breach_notifications"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "pad_mandates" ADD CONSTRAINT "pad_mandates_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pad_transactions" ADD CONSTRAINT "pad_transactions_mandate_id_fkey" FOREIGN KEY ("mandate_id") REFERENCES "pad_mandates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pad_transactions" ADD CONSTRAINT "pad_transactions_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phipa_deletion_requests" ADD CONSTRAINT "phipa_deletion_requests_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phipa_breach_notifications" ADD CONSTRAINT "phipa_breach_notifications_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "claim_evidence_items_claim_id_recovery_action_id_evidence_type_" RENAME TO "claim_evidence_items_claim_id_recovery_action_id_evidence_t_key";

