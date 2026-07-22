-- AlterTable
ALTER TABLE "claim_recovery_actions" ADD COLUMN     "auto_escalate_at" TIMESTAMP(3),
ADD COLUMN     "deadline" TIMESTAMP(3),
ADD COLUMN     "escalated_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "idx_recovery_actions_auto_escalate" ON "claim_recovery_actions"("auto_escalate_at");

