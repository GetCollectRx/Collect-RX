-- Per-result provenance so a practice can see how each call outcome was derived
-- and how far to trust it. Columns are nullable: calls completed before this
-- migration keep NULL rather than a guessed value. call_attempts already carries
-- tenant isolation through its claim, so no new policy is needed for new columns.
CREATE TYPE "result_source" AS ENUM ('HUMAN_LOG', 'STRUCTURED_PAYLOAD', 'TRANSCRIPT_CLASSIFIER');
CREATE TYPE "result_confidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

ALTER TABLE "call_attempts"
  ADD COLUMN "result_source" "result_source",
  ADD COLUMN "result_confidence" "result_confidence";

-- Vendor cost per call, captured so Day 60 gross margin is computed from
-- recorded spend rather than estimated. Whole cents, NULL when not reported.
ALTER TABLE "call_attempts" ADD COLUMN "vendor_cost_cents" INTEGER;
