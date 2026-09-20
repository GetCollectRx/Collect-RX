-- AlterTable
ALTER TABLE "insurance_claims" ADD COLUMN     "resolved_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "insurance_claims_practice_id_status_resolved_at_idx" ON "insurance_claims"("practice_id", "status", "resolved_at");
