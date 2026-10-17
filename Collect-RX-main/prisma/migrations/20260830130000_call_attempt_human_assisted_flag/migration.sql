-- V1 human-assisted squad calls set this true so the learning-loop webhook
-- path can exclude them from CarrierLesson extraction, which is scoped to
-- the fully-autonomous squad only. See HumanAssistedCallLog / migration
-- 20260830120000_human_assisted_call_logging for V1's own separate path.
ALTER TABLE "call_attempts"
  ADD COLUMN "is_human_assisted" BOOLEAN NOT NULL DEFAULT false;
