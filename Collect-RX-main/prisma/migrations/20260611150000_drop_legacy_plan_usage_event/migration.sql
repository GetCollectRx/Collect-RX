-- Drop the legacy outcome-gated Plan/UsageEvent model.
--
-- Cutover to minutes-based billing (src/billing/tiers.ts, UsagePeriod,
-- FeatureFlag — added in 20260611120000_billing_minutes_metering) is
-- complete: planBridge.ts and all callers (queueEngine, vapiDeskEvents,
-- insurance routes, billingRoutes, stripe/billing) now read/write
-- UsagePeriod/FeatureFlag exclusively. See tasks/lessons.md.
--
-- The only remaining readers of "plans"/"usage_events" are the dead
-- src/services/plans/*.cjs services (reachable only from the unused
-- src/index.js raw-SQL stack — the live backend is src/server/index.ts).
--
-- Run this AFTER 20260611120000_billing_minutes_metering has been applied
-- and the minutes-based gate has been verified in production.

DROP TABLE IF EXISTS "plans" CASCADE;
DROP TABLE IF EXISTS "usage_events" CASCADE;

DROP TYPE IF EXISTS "PlanTier";
DROP TYPE IF EXISTS "PlanStatus";
DROP TYPE IF EXISTS "UsageEventType";
