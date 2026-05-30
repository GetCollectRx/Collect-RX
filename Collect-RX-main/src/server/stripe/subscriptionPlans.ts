import type { PrismaClient } from '@prisma/client';

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
  usage?: SubscriptionUsageState;
  plan?: SubscriptionPlanSnapshot | null;
};

type PracticeSubscriptionFields = {
  subscriptionStatus?: string | null;
  subscriptionPriceId?: string | null;
  subscriptionPlanId?: string | null;
  subscriptionCurrentPeriodStart?: Date | null;
  subscriptionCurrentPeriodEnd?: Date | null;
};

type RawPlan = {
  priceId?: unknown;
  planId?: unknown;
  id?: unknown;
  name?: unknown;
  displayName?: unknown;
  monthlyClaimLimit?: unknown;
  claimLimit?: unknown;
};

function readPositiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function readEnvLimit(name: string, fallback: number): number {
  return readPositiveInt(process.env[name]) ?? fallback;
}

function parseRawPlan(raw: RawPlan, fallbackPriceId?: string): SubscriptionPlanSnapshot | null {
  const priceId = typeof raw.priceId === 'string' && raw.priceId.trim()
    ? raw.priceId.trim()
    : fallbackPriceId?.trim() || null;
  const idSource = raw.planId ?? raw.id;
  const id = typeof idSource === 'string' && idSource.trim()
    ? idSource.trim()
    : priceId
      ? `price_${priceId.slice(-8)}`
      : null;
  if (!id) return null;
  const displayName = typeof raw.displayName === 'string' && raw.displayName.trim()
    ? raw.displayName.trim()
    : typeof raw.name === 'string' && raw.name.trim()
      ? raw.name.trim()
      : id.replace(/[-_]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  const rawLimit = raw.monthlyClaimLimit ?? raw.claimLimit;
  const monthlyClaimLimit = rawLimit === null ? null : readPositiveInt(rawLimit);
  return {
    id,
    displayName,
    priceId,
    monthlyClaimLimit,
  };
}

function parseJsonPlanCatalog(): SubscriptionPlanSnapshot[] {
  const raw = process.env.SUBSCRIPTION_PLAN_CONFIG?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    const rows: SubscriptionPlanSnapshot[] = [];
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        const plan = parseRawPlan(entry as RawPlan);
        if (plan) rows.push(plan);
      }
      return rows;
    }
    if (parsed && typeof parsed === 'object') {
      for (const [priceId, entry] of Object.entries(parsed as Record<string, RawPlan>)) {
        const plan = parseRawPlan(entry, priceId);
        if (plan) rows.push(plan);
      }
    }
    return rows;
  } catch (e) {
    console.warn('[subscription-plans] Ignoring invalid SUBSCRIPTION_PLAN_CONFIG JSON:', e);
    return [];
  }
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

export function subscriptionPlanCatalog(): SubscriptionPlanSnapshot[] {
  const configured = parseJsonPlanCatalog();
  if (configured.length > 0) return configured;

  const plans: SubscriptionPlanSnapshot[] = [];
  const starter = process.env.STRIPE_PRACTICE_STARTER_PRICE_ID?.trim();
  const professional = process.env.STRIPE_PRACTICE_PROFESSIONAL_PRICE_ID?.trim();
  const enterprise = process.env.STRIPE_PRACTICE_ENTERPRISE_PRICE_ID?.trim();

  if (starter) {
    plans.push({
      id: 'starter',
      displayName: 'Starter',
      priceId: starter,
      monthlyClaimLimit: readEnvLimit('SUBSCRIPTION_STARTER_MONTHLY_CLAIM_LIMIT', 50),
    });
  }
  if (professional) {
    plans.push({
      id: 'professional',
      displayName: 'Professional',
      priceId: professional,
      monthlyClaimLimit: readEnvLimit('SUBSCRIPTION_PROFESSIONAL_MONTHLY_CLAIM_LIMIT', 200),
    });
  }
  if (enterprise) {
    plans.push({
      id: 'enterprise',
      displayName: 'Enterprise',
      priceId: enterprise,
      monthlyClaimLimit: readPositiveInt(process.env.SUBSCRIPTION_ENTERPRISE_MONTHLY_CLAIM_LIMIT) ?? null,
    });
  }

  const legacyPrice = process.env.STRIPE_PRACTICE_SUBSCRIPTION_PRICE_ID?.trim();
  if (legacyPrice && !plans.some((plan) => plan.priceId === legacyPrice)) {
    plans.push({
      id: 'standard',
      displayName: process.env.SUBSCRIPTION_DEFAULT_PLAN_NAME?.trim() || 'CollectRx Standard',
      priceId: legacyPrice,
      monthlyClaimLimit: readEnvLimit('SUBSCRIPTION_DEFAULT_MONTHLY_CLAIM_LIMIT', 100),
    });
  }

  return plans;
}

export function defaultSubscriptionPlan(): SubscriptionPlanSnapshot | null {
  const catalog = subscriptionPlanCatalog();
  const defaultId = process.env.SUBSCRIPTION_DEFAULT_PLAN_ID?.trim();
  if (defaultId) {
    const configuredDefault = catalog.find((plan) => plan.id === defaultId);
    if (configuredDefault) return configuredDefault;
  }
  const legacyPrice = process.env.STRIPE_PRACTICE_SUBSCRIPTION_PRICE_ID?.trim();
  if (legacyPrice) {
    const legacyPlan = catalog.find((plan) => plan.priceId === legacyPrice);
    if (legacyPlan) return legacyPlan;
  }
  return catalog[0] ?? null;
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
