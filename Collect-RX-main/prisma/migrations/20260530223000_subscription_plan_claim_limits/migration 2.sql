-- Track the CollectRx subscription plan/price that determines monthly claim capacity.

ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "subscriptionPriceId" TEXT;
ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "subscriptionPlanId" TEXT;
ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "subscriptionCurrentPeriodStart" TIMESTAMP(3);
