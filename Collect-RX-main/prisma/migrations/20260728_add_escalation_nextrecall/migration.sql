-- Add next_recall_at to call_queue
ALTER TABLE "call_queue" ADD COLUMN "next_recall_at" TIMESTAMP(3);

-- Create escalations table
CREATE TABLE "escalations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claim_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "reason" TEXT NOT NULL,
    "metadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolution" TEXT,
    CONSTRAINT "escalations_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "insurance_claims" ("id") ON DELETE CASCADE
);

-- Create indexes
CREATE INDEX "escalations_claim_id_status_idx" ON "escalations"("claim_id", "status");
CREATE INDEX "escalations_created_at_idx" ON "escalations"("created_at" DESC);
