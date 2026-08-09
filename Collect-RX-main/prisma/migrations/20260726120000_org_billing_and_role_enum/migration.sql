-- Org-level consolidated billing (enterprise/DSO deals) + OrganizationMember.role enum.
--
-- OrganizationMember.role was an unconstrained String defaulting to 'org_admin'
-- and was never written by any code path outside 'org_admin' — cast defensively
-- (fall back to 'org_admin' for anything unexpected) instead of a blind drop/recreate,
-- so any row that somehow held a different value isn't silently reset.

CREATE TYPE "OrganizationRole" AS ENUM ('org_admin', 'org_member');

ALTER TABLE "organization_members"
  ALTER COLUMN "role" DROP DEFAULT,
  ALTER COLUMN "role" TYPE "OrganizationRole" USING (
    CASE
      WHEN "role" IN ('org_admin', 'org_member') THEN "role"::"OrganizationRole"
      ELSE 'org_admin'::"OrganizationRole"
    END
  ),
  ALTER COLUMN "role" SET DEFAULT 'org_admin';

-- ── Organization: consolidated Stripe billing fields (mirrors Practice) ─────

ALTER TABLE "organizations"
  ADD COLUMN "stripe_customer_id" TEXT,
  ADD COLUMN "stripe_subscription_id" TEXT,
  ADD COLUMN "subscription_status" TEXT,
  ADD COLUMN "subscription_price_id" TEXT,
  ADD COLUMN "subscription_plan_id" TEXT,
  ADD COLUMN "subscription_current_period_start" TIMESTAMP(3),
  ADD COLUMN "subscription_current_period_end" TIMESTAMP(3),
  ADD COLUMN "billing_tier" "BillingTier",
  ADD COLUMN "billing_period_start" TIMESTAMP(3),
  ADD COLUMN "trial_ends_at" TIMESTAMP(3),
  ADD COLUMN "calls_paused" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "calls_paused_reason" TEXT,
  ADD COLUMN "calls_paused_at" TIMESTAMP(3),
  ADD COLUMN "overage_confirmed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "overage_confirmed_at" TIMESTAMP(3),
  ADD COLUMN "cogs_pooling_enabled" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX "organizations_stripe_customer_id_key" ON "organizations"("stripe_customer_id");
CREATE UNIQUE INDEX "organizations_stripe_subscription_id_key" ON "organizations"("stripe_subscription_id");
