-- W4: additive register fields on phipa_breach_notifications.
-- All columns are nullable or defaulted, so existing rows and current behaviour are unchanged.
-- RLS is already enabled and forced on this table (20260926200000_multi_practice_rls_coverage).
ALTER TABLE "phipa_breach_notifications"
  ADD COLUMN IF NOT EXISTS "circumstances" TEXT,
  ADD COLUMN IF NOT EXISTS "occurred_from" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "occurred_to" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "discovered_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "data_elements" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "number_of_individuals" INTEGER,
  ADD COLUMN IF NOT EXISTS "steps_to_reduce_harm" TEXT,
  ADD COLUMN IF NOT EXISTS "notification_steps" TEXT,
  ADD COLUMN IF NOT EXISTS "contact_name" TEXT,
  ADD COLUMN IF NOT EXISTS "annual_categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "real_risk_of_significant_harm" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "custodian_notified_at" TIMESTAMP(3);
