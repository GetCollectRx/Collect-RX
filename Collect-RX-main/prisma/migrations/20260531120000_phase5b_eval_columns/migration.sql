-- Phase 5b: 8-dimension automated call evaluation columns
--
-- Adds eval_completed_at and eval_scores to call_attempts.
-- Both are nullable — existing rows default to NULL (not yet evaluated).
--
-- eval_completed_at: ISO timestamp set once the LLM evaluation pipeline
--   has scored the call transcript. Used as the gate signal for:
--     (a) zero-retention audio deletion (pii-vault.ts)
--     (b) eval-scores analytics caching (routes/analytics.ts)
--
-- eval_scores: JSON text — serialised DimensionScore[] from automated-eval.ts.
--   No PHI. Contains numeric scores (0-100) and 1-2 sentence rationale per
--   dimension. Safe to store unencrypted (same classification as outcome_detail).
--
-- Both columns are indexed on eval_completed_at to support efficient queries
-- for "calls not yet evaluated" and dashboard lookback windows.

ALTER TABLE "call_attempts"
  ADD COLUMN "eval_completed_at" TIMESTAMP(3),
  ADD COLUMN "eval_scores"       TEXT;

-- Index to efficiently find calls awaiting evaluation (eval_completed_at IS NULL)
-- and to query within date windows for the analytics endpoint.
CREATE INDEX "call_attempts_eval_completed_at_idx"
  ON "call_attempts" ("eval_completed_at");
