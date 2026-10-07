-- Hold Sentinel entry plan (ADR 0004). Additive and idempotent: existing
-- rows keep their tier; IF NOT EXISTS makes a re-run a no-op.
ALTER TYPE "BillingTier" ADD VALUE IF NOT EXISTS 'sentinel' BEFORE 'core';
