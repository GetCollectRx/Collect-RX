-- Add parsed_claim_outcome JSON field to call_attempts for LLM transcript parsing results
ALTER TABLE "call_attempts" ADD COLUMN "parsed_claim_outcome" jsonb;

-- Create index for querying calls with parsed outcomes (for ledger note display)
CREATE INDEX "idx_call_attempts_parsed_outcome" ON "call_attempts"("parsed_claim_outcome") WHERE "parsed_claim_outcome" IS NOT NULL;
