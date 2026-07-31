-- Preserve claim history while removing deleted claims from operational reads.
ALTER TABLE "insurance_claims"
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "insurance_claims_practice_id_deleted_at_idx"
  ON "insurance_claims"("practice_id", "deleted_at");
