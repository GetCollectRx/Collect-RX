-- AlterTable
ALTER TABLE "cob_routes" ADD COLUMN IF NOT EXISTS "escalated_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "cob_routes_escalated_at_idx" ON "cob_routes"("escalated_at");
