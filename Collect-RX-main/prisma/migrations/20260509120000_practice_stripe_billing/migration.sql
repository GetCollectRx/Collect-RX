-- Practice subscription billing (Stripe Billing on the platform account)

ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT;
ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "stripeSubscriptionId" TEXT;
ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "subscriptionStatus" TEXT;
ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "subscriptionCurrentPeriodEnd" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "Practice_stripeCustomerId_key" ON "Practice"("stripeCustomerId");
CREATE UNIQUE INDEX IF NOT EXISTS "Practice_stripeSubscriptionId_key" ON "Practice"("stripeSubscriptionId");
