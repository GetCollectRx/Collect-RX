-- DropForeignKey
ALTER TABLE "guardrail_audit_outbox" DROP CONSTRAINT "guardrail_audit_outbox_call_attempt_id_fkey";

-- DropForeignKey
ALTER TABLE "guardrail_audits" DROP CONSTRAINT "guardrail_audits_call_attempt_id_fkey";

-- AlterTable
ALTER TABLE "call_attempts" ADD COLUMN     "validation_passed" BOOLEAN,
ADD COLUMN     "validation_result" JSONB;

-- AlterTable
ALTER TABLE "guardrail_audit_outbox" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "enqueued_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "processed_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "guardrail_audits" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "ran_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "risk_score" SET DATA TYPE DECIMAL(65,30);

-- CreateTable
CREATE TABLE "ProcessedValidatorWebhook" (
    "id" TEXT NOT NULL,
    "body_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedValidatorWebhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeNotification" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "claim_id" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PracticeNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedValidatorWebhook_body_hash_key" ON "ProcessedValidatorWebhook"("body_hash");

-- CreateIndex
CREATE INDEX "PracticeNotification_practice_id_idx" ON "PracticeNotification"("practice_id");

-- CreateIndex
CREATE INDEX "PracticeNotification_claim_id_idx" ON "PracticeNotification"("claim_id");

-- CreateIndex
CREATE INDEX "PracticeNotification_read_at_idx" ON "PracticeNotification"("read_at");

-- CreateIndex
CREATE INDEX "PracticeNotification_created_at_idx" ON "PracticeNotification"("created_at");

-- CreateIndex
CREATE INDEX "call_queue_practice_id_status_updated_at_idx" ON "call_queue"("practice_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "insurance_claims_practice_id_status_updated_at_idx" ON "insurance_claims"("practice_id", "status", "updated_at");

-- AddForeignKey
ALTER TABLE "PracticeNotification" ADD CONSTRAINT "PracticeNotification_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeNotification" ADD CONSTRAINT "PracticeNotification_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "insurance_claims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardrail_audit_outbox" ADD CONSTRAINT "guardrail_audit_outbox_call_attempt_id_fkey" FOREIGN KEY ("call_attempt_id") REFERENCES "call_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardrail_audits" ADD CONSTRAINT "guardrail_audits_call_attempt_id_fkey" FOREIGN KEY ("call_attempt_id") REFERENCES "call_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "eligibility_snapshots_practice_id_patient_token_carrier_verifie" RENAME TO "eligibility_snapshots_practice_id_patient_token_carrier_ver_idx";

-- RenameIndex
ALTER INDEX "idx_guardrail_audit_outbox_enqueued_at" RENAME TO "guardrail_audit_outbox_enqueued_at_idx";

-- RenameIndex
ALTER INDEX "idx_guardrail_audit_outbox_processed_at" RENAME TO "guardrail_audit_outbox_processed_at_idx";

-- RenameIndex
ALTER INDEX "idx_guardrail_audits_call_attempt_id" RENAME TO "guardrail_audits_call_attempt_id_idx";

-- RenameIndex
ALTER INDEX "idx_guardrail_audits_ran_at" RENAME TO "guardrail_audits_ran_at_idx";

-- RenameIndex
ALTER INDEX "idx_guardrail_audits_risk_score" RENAME TO "guardrail_audits_risk_score_idx";

-- RenameIndex
ALTER INDEX "idx_guardrail_audits_unique" RENAME TO "guardrail_audits_call_attempt_id_rules_version_key";

-- RenameIndex
ALTER INDEX "scheduled_appointments_practice_id_pms_source_pms_appointment_i" RENAME TO "scheduled_appointments_practice_id_pms_source_pms_appointme_key";
