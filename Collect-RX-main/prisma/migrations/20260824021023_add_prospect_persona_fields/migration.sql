-- AlterTable
ALTER TABLE "prospects" ADD COLUMN     "persona_assigned_at" TIMESTAMP(3),
ADD COLUMN     "persona_bucket" TEXT,
ADD COLUMN     "persona_confidence" TEXT,
ADD COLUMN     "persona_reasoning" TEXT;

-- CreateIndex
CREATE INDEX "prospects_persona_bucket_idx" ON "prospects"("persona_bucket");
