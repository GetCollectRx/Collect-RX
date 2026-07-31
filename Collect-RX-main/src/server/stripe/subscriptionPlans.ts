import type { BillingTier, PrismaClient } from '@prisma/client';
import { TIERS } from '../../billing/tiers.js';

export type SubscriptionPlanSnapshot = {
  id: string;
  displayName: string;
  priceId: string | null;
  monthlyClaimLimit: number | null;
};

export type SubscriptionUsageState = {
  periodStart: string;
  periodEnd: string;
  usedClaims: number;
  monthlyClaimLimit: number | null;
  remainingClaims: number | null;
  limitReached: boolean;
};

export type SubscriptionCapacityGuard = {
  allowed: boolean;
  code?: string;
  reason?: string;
  usage?: SubscriptionUsageState | null;
  plan?: SubscriptionPlanSnapshot | null;
};

type PracticeSubscriptionFields = {
  subscriptionStatus?: string | null;
  subscriptionPriceId?: string | null;
  subscriptionPlanId?: string | null;
  subscriptionCurrentPeriodStart?: Date | null;
  subscriptionCurrentPeriodEnd?: Date | null;
};

/** When true and a subscription price is configured, practices must be active/trialing (or skip-listed). */
export function subscriptionEnforceEnabled(): boolean {
  return process.env.SUBSCRIPTION_ENFORCE === '1' || process.env.SUBSCRIPTION_ENFORCE === 'true';
}

export function billingSkipPracticeIds(): Set<string> {
  const raw = process.env.BILLING_SKIP_PRACTICE_IDS || '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function subscriptionClaimLimitEnforceEnabled(): boolean {
  const raw = process.env.SUBSCRIPTION_CLAIM_LIMIT_ENFORCE;
  if (raw === undefined) return true;
  return raw === '1' || raw.toLowerCase() === 'true';
}

const PAID_TIER_IDS: BillingTier[] = ['core', 'growth', 'scale'];

let warnedLegacyPlanConfig = false;

/**
 * The sellable catalog is exactly the paid tiers in src/billing/tiers.ts with
 * a configured Stripe price. Plan ids equal BillingTier values, so a Checkout
 * price ID always maps back to the minute pool that price sells — a stale
 * plan name can never unlock the wrong allowance. Claim-count limits are
 * retired: minutes (UsagePeriod) are the meter.
 */
export function subscriptionPlanCatalog(): SubscriptionPlanSnapshot[] {
  if (process.env.SUBSCRIPTION_PLAN_CONFIG?.trim() && !warnedLegacyPlanConfig) {
    warnedLegacyPlanConfig = true;
    console.warn(
      '[subscription-plans] SUBSCRIPTION_PLAN_CONFIG is no longer supported — the catalog is core/growth/scale from tiers.ts (STRIPE_PRICE_CORE|GROWTH|SCALE).',
    );
  }
  return PAID_TIER_IDS.flatMap((id) => {
    const tier = TIERS[id];
    if (!tier.stripePriceId) return [];
    return [
      {
        id,
        displayName: tier.name,
        priceId: tier.stripePriceId,
        monthlyClaimLimit: null,
      },
    ];
  });
}

export function defaultSubscriptionPlan(): SubscriptionPlanSnapshot | null {
  const catalog = subscriptionPlanCatalog();
  const defaultId = process.env.SUBSCRIPTION_DEFAULT_PLAN_ID?.trim();
  if (defaultId) {
    const configuredDefault = catalog.find((plan) => plan.id === defaultId);
    if (configuredDefault) return configuredDefault;
  }
  return catalog.find((plan) => plan.id === 'core') ?? catalog[0] ?? null;
}

export function subscriptionPlanById(planId: string | null | undefined): SubscriptionPlanSnapshot | null {
  if (!planId) return null;
  return subscriptionPlanCatalog().find((plan) => plan.id === planId) ?? null;
}

export function subscriptionPlanByPriceId(priceId: string | null | undefined): SubscriptionPlanSnapshot | null {
  if (!priceId) return null;
  return subscriptionPlanCatalog().find((plan) => plan.priceId === priceId) ?? null;
}

export function resolvePracticeSubscriptionPlan(
  practice: PracticeSubscriptionFields | null | undefined,
): SubscriptionPlanSnapshot | null {
  return (
    subscriptionPlanByPriceId(practice?.subscriptionPriceId) ??
    subscriptionPlanById(practice?.subscriptionPlanId) ??
    defaultSubscriptionPlan()
  );
}

function calendarMonthWindow(now: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { start, end };
}

export function subscriptionUsageWindow(
  practice: PracticeSubscriptionFields | null | undefined,
  now = new Date(),
): { start: Date; end: Date } {
  const fallback = calendarMonthWindow(now);
  const start = practice?.subscriptionCurrentPeriodStart ?? fallback.start;
  const rawEnd = practice?.subscriptionCurrentPeriodEnd ?? fallback.end;
  const end = rawEnd > start ? rawEnd : fallback.end;
  return { start, end };
}

export async function countAddressedClaimsForPeriod(
  db: PrismaClient,
  practiceId: string,
  start: Date,
  end: Date,
): Promise<number> {
  const rows = await db.callAttempt.findMany({
    where: {
      initiatedAt: { gte: start, lt: end },
      claim: { practiceId },
    },
    select: { claimId: true },
    distinct: ['claimId'],
  });
  return rows.length;
}

export async function getSubscriptionUsageState(
  db: PrismaClient,
  practiceId: string,
  practice?: PracticeSubscriptionFields | null,
  now = new Date(),
): Promise<{ plan: SubscriptionPlanSnapshot | null; usage: SubscriptionUsageState | null }> {
  const subscriptionFields = practice ?? await db.practice.findUnique({
    where: { id: practiceId },
    select: {
      subscriptionStatus: true,
      subscriptionPriceId: true,
      subscriptionPlanId: true,
      subscriptionCurrentPeriodStart: true,
      subscriptionCurrentPeriodEnd: true,
    },
  });
  const plan = resolvePracticeSubscriptionPlan(subscriptionFields);
  if (!plan) return { plan: null, usage: null };

  const { start, end } = subscriptionUsageWindow(subscriptionFields, now);
  const usedClaims = await countAddressedClaimsForPeriod(db, practiceId, start, end);
  const remainingClaims = plan.monthlyClaimLimit === null
    ? null
    : Math.max(0, plan.monthlyClaimLimit - usedClaims);
  return {
    plan,
    usage: {
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      usedClaims,
      monthlyClaimLimit: plan.monthlyClaimLimit,
      remainingClaims,
      limitReached: plan.monthlyClaimLimit !== null && usedClaims >= plan.monthlyClaimLimit,
    },
  };
}

export async function validateSubscriptionClaimCapacity(
  db: PrismaClient,
  params: { practiceId: string; claimId?: string; now?: Date },
): Promise<SubscriptionCapacityGuard> {
  if (!subscriptionClaimLimitEnforceEnabled()) return { allowed: true };
  if (billingSkipPracticeIds().has(params.practiceId)) return { allowed: true };

  const practice = await db.practice.findUnique({
    where: { id: params.practiceId },
    select: {
      subscriptionStatus: true,
      subscriptionPriceId: true,
      subscriptionPlanId: true,
      subscriptionCurrentPeriodStart: true,
      subscriptionCurrentPeriodEnd: true,
    },
  });
  const { plan, usage } = await getSubscriptionUsageState(db, params.practiceId, practice, params.now);
  if (!plan || !usage || plan.monthlyClaimLimit === null) return { allowed: true, plan, usage };
  if (params.claimId) {
    const { start, end } = subscriptionUsageWindow(practice, params.now ?? new Date());
    const alreadyAddressedThisPeriod = await db.callAttempt.findFirst({
      where: {
        claimId: params.claimId,
        initiatedAt: { gte: start, lt: end },
        claim: { practiceId: params.practiceId },
      },
      select: { id: true },
    });
    if (alreadyAddressedThisPeriod) return { allowed: true, plan, usage };
  }
  if (!usage.limitReached) return { allowed: true, plan, usage };

  return {
    allowed: false,
    code: 'SUBSCRIPTION_CLAIM_LIMIT_REACHED',
    plan,
    usage,
    reason:
      `${plan.displayName} plan monthly claim limit reached ` +
      `(${usage.usedClaims}/${plan.monthlyClaimLimit}). The next claim period starts ${usage.periodEnd.slice(0, 10)}.`,
  };
}
