/**
 * Minutes-based usage metering — backs canMakeCall()/recordCallUsage() in planBridge.ts.
 *
 * Replaces the outcome-gated Plan/UsageEvent model. A practice's billing tier
 * (trial/core/growth/scale, src/billing/tiers.ts) includes a monthly minute
 * allowance tracked on UsagePeriod. When the allowance is exhausted:
 *   - trial (hardStopAtLimit) → calls blocked until upgrade
 *   - paid tiers → calls paused (callsPaused/callsPausedReason='overage_pending')
 *     until the practice confirms overage charges via confirmOverage().
 */
import type { Organization, Practice, PrismaClient, UsagePeriod } from '@prisma/client';
import {
  billingTierForStripePrice,
  CALL_TIMEOUTS,
  COGS_BREAKER,
  OVERAGE,
  TIERS,
  UNIT_ECONOMICS,
  WARNINGS,
  type TierConfig,
} from '../../billing/tiers.js';
import {
  billingSkipPracticeIds,
  subscriptionEnforceEnabled,
} from '../stripe/subscriptionPlans.js';
import { resolveBillingEntity } from '../stripe/billingEntity.js';

export type PlanGateReason =
  | 'OK'
  | 'TRIAL_LIMIT_REACHED'
  | 'OVERAGE_PENDING'
  | 'DAILY_CAP_REACHED'
  | 'SUBSCRIPTION_PAST_DUE'
  | 'SUBSCRIPTION_CANCELED'
  | 'COGS_BREAKER_PAUSED'
  | 'BILLING_MISCONFIGURED';

export type PlanGateResult = {
  allowed: boolean;
  reason: PlanGateReason;
  overageRatePerMinute?: number | null;
  /** COGS breaker throttle — dispatch only HIGH/URGENT priority claims. */
  essentialOnly?: boolean;
};

type PeriodWindow = { periodStart: Date; periodEnd: Date };

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function tierFor(practice: Practice): TierConfig {
  return TIERS[practice.billingTier];
}

/** Best-effort window for a freshly-created UsagePeriod when none covers "now". */
function fallbackPeriodWindow(practice: Practice, now: Date): PeriodWindow {
  const tier = tierFor(practice);
  if (practice.billingTier === 'trial') {
    const periodEnd = practice.trialEndsAt ?? addDays(now, tier.trialDays ?? 30);
    const periodStart = addDays(periodEnd, -(tier.trialDays ?? 30));
    return { periodStart, periodEnd };
  }
  const periodEnd = practice.subscriptionCurrentPeriodEnd ?? addMonths(now, 1);
  const periodStart = practice.billingPeriodStart ?? addMonths(periodEnd, -1);
  return { periodStart, periodEnd };
}

export async function getOrCreateUsagePeriod(prisma: PrismaClient, practice: Practice): Promise<UsagePeriod> {
  const now = new Date();
  const existing = await prisma.usagePeriod.findFirst({
    where: { practiceId: practice.id, periodStart: { lte: now }, periodEnd: { gte: now } },
    orderBy: { periodStart: 'desc' },
  });
  if (existing) return existing;

  const window = fallbackPeriodWindow(practice, now);
  return prisma.usagePeriod.create({
    data: { practiceId: practice.id, periodStart: window.periodStart, periodEnd: window.periodEnd },
  });
}

export async function getTodayMinutes(prisma: PrismaClient, practiceId: string): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const result = await prisma.callAttempt.aggregate({
    where: {
      claim: { practiceId },
      completedAt: { gte: startOfDay },
      minutesBilled: { not: null },
    },
    _sum: { minutesBilled: true },
  });
  return result._sum.minutesBilled ?? 0;
}

/** Pause calling and mark why. Idempotent — does nothing if already paused. */
async function pauseCalls(prisma: PrismaClient, practiceId: string, reason: string): Promise<void> {
  await prisma.practice.updateMany({
    where: { id: practiceId, callsPaused: false },
    data: { callsPaused: true, callsPausedReason: reason, callsPausedAt: new Date() },
  });
}

async function triggerSoftStop(prisma: PrismaClient, practice: Practice): Promise<void> {
  await pauseCalls(prisma, practice.id, 'overage_pending');
}

async function pauseOrgCalls(prisma: PrismaClient, organizationId: string, reason: string): Promise<void> {
  await prisma.organization.updateMany({
    where: { id: organizationId, callsPaused: false },
    data: { callsPaused: true, callsPausedReason: reason, callsPausedAt: new Date() },
  });
}

/**
 * Same get-or-create as getOrCreateUsagePeriod, but the fallback window comes
 * from the ORG's billing cycle, not the practice's own billingTier/trialEndsAt
 * — those go unused once a practice is org-billed (see billingEntity.ts).
 */
async function getOrCreateOrgAlignedUsagePeriod(
  prisma: PrismaClient,
  practiceId: string,
  org: Organization,
): Promise<UsagePeriod> {
  const now = new Date();
  const existing = await prisma.usagePeriod.findFirst({
    where: { practiceId, periodStart: { lte: now }, periodEnd: { gte: now } },
    orderBy: { periodStart: 'desc' },
  });
  if (existing) return existing;

  const periodEnd = org.subscriptionCurrentPeriodEnd ?? addMonths(now, 1);
  const periodStart = org.billingPeriodStart ?? addMonths(periodEnd, -1);
  return prisma.usagePeriod.create({ data: { practiceId, periodStart, periodEnd } });
}

/**
 * Pooled equivalent of evaluateCallGate — sums minutesConsumed across every
 * member practice's current-cycle UsagePeriod and gates on the ORG's tier,
 * not any one practice's. Pause/throttle apply to the whole org: there's no
 * per-practice cost attribution to decide which location is "driving" an
 * overage, so the pool being exhausted pauses every member practice together.
 */
async function evaluateOrgCallGate(
  prisma: PrismaClient,
  organizationId: string,
  memberPracticeIds: string[],
): Promise<PlanGateResult> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) {
    return { allowed: false, reason: 'SUBSCRIPTION_CANCELED' };
  }

  if (org.subscriptionStatus === 'canceled') {
    return { allowed: false, reason: 'SUBSCRIPTION_CANCELED' };
  }
  if (org.subscriptionStatus === 'past_due' || org.subscriptionStatus === 'unpaid') {
    return { allowed: false, reason: 'SUBSCRIPTION_PAST_DUE' };
  }
  if (!org.billingTier) {
    // Org has a Stripe customer (resolveBillingEntity's org-billed signal)
    // but no tier yet — checkout started but the subscription webhook
    // hasn't landed. Fail closed rather than guessing a minute pool.
    console.error(
      `[planGate] org=${organizationId} is billed but has no billingTier yet — blocking until the subscription webhook lands.`,
    );
    return { allowed: false, reason: 'BILLING_MISCONFIGURED' };
  }
  const tier = TIERS[org.billingTier];

  if (org.callsPaused) {
    switch (org.callsPausedReason) {
      case 'payment_failed':
        return { allowed: false, reason: 'SUBSCRIPTION_PAST_DUE' };
      case 'subscription_cancelled':
        return { allowed: false, reason: 'SUBSCRIPTION_CANCELED' };
      case 'cogs_breaker':
        return { allowed: false, reason: 'COGS_BREAKER_PAUSED' };
      default:
        return { allowed: false, reason: 'OVERAGE_PENDING', overageRatePerMinute: tier.overageRatePerMinute };
    }
  }

  const periods = await Promise.all(
    memberPracticeIds.map((pid) => getOrCreateOrgAlignedUsagePeriod(prisma, pid, org)),
  );
  const minutesConsumed = periods.reduce((sum, p) => sum + p.minutesConsumed, 0);

  const inOverage = minutesConsumed >= tier.includedMinutes;
  if (inOverage) {
    if (tier.hardStopAtLimit) {
      return { allowed: false, reason: 'TRIAL_LIMIT_REACHED' };
    }
    if (!org.overageConfirmed) {
      await pauseOrgCalls(prisma, organizationId, 'overage_pending');
      return { allowed: false, reason: 'OVERAGE_PENDING', overageRatePerMinute: tier.overageRatePerMinute };
    }
  }

  const cogs = evaluateCogsBreaker(tier, minutesConsumed);
  const overageRatePerMinute = inOverage ? tier.overageRatePerMinute : undefined;

  if (cogs === 'pause') {
    await pauseOrgCalls(prisma, organizationId, 'cogs_breaker');
    console.error(
      `[cogsBreaker] pooled delivery cost crossed ${Math.round(COGS_BREAKER.pauseAtPctOfPrice * 100)}% ` +
        `of revenue collected — pausing calls for org=${organizationId} ` +
        `(${minutesConsumed} pooled min consumed on ${org.billingTier})`,
    );
    try {
      const { dispatchOpsAlert } = await import('../observability/opsAlerts.js');
      await dispatchOpsAlert({
        alertId: 'cogs_breaker',
        source: organizationId,
        detail: `${minutesConsumed} pooled min consumed on ${org.billingTier} tier`,
      });
    } catch (alertErr) {
      console.error('[cogsBreaker] ops alert dispatch failed (non-fatal):', alertErr);
    }
    return { allowed: false, reason: 'COGS_BREAKER_PAUSED' };
  }
  if (cogs === 'throttle') {
    return { allowed: true, reason: 'OK', essentialOnly: true, overageRatePerMinute };
  }

  return { allowed: true, reason: 'OK', overageRatePerMinute };
}

/**
 * The gate. Called by the queue dispatcher and manual-call routes BEFORE every dispatch.
 * Never throws — a missing practice is treated as a hard block.
 */
export async function evaluateCallGate(prisma: PrismaClient, practiceId: string): Promise<PlanGateResult> {
  const practice = await prisma.practice.findUnique({ where: { id: practiceId } });
  if (!practice) {
    return { allowed: false, reason: 'SUBSCRIPTION_CANCELED' };
  }

  const billingEntity = await resolveBillingEntity(prisma, practiceId);
  if (billingEntity.kind === 'organization') {
    const org = await prisma.organization.findUnique({
      where: { id: billingEntity.organizationId },
      select: { cogsPoolingEnabled: true },
    });
    if (org?.cogsPoolingEnabled) {
      return evaluateOrgCallGate(prisma, billingEntity.organizationId, billingEntity.memberPracticeIds);
    }
  }

  const tier = tierFor(practice);
  const now = new Date();

  if (practice.subscriptionStatus === 'canceled') {
    return { allowed: false, reason: 'SUBSCRIPTION_CANCELED' };
  }
  if (practice.subscriptionStatus === 'past_due' || practice.subscriptionStatus === 'unpaid') {
    return { allowed: false, reason: 'SUBSCRIPTION_PAST_DUE' };
  }

  if (practice.billingTier === 'trial' && practice.trialEndsAt && practice.trialEndsAt < now) {
    return { allowed: false, reason: 'TRIAL_LIMIT_REACHED' };
  }

  // Fail closed: under SUBSCRIPTION_ENFORCE a paid tier is only callable when
  // Stripe is actually configured and the subscription is live. A practice
  // whose tier has no price env, whose stored price ID maps to a different
  // tier, or whose subscription never activated must not get a minute pool.
  if (practice.billingTier !== 'trial' && subscriptionEnforceEnabled() && !billingSkipPracticeIds().has(practice.id)) {
    if (!tier.stripePriceId) {
      console.error(
        `[planGate] SUBSCRIPTION_ENFORCE is on but no Stripe price is configured for tier=${practice.billingTier} — blocking practice=${practice.id}`,
      );
      return { allowed: false, reason: 'BILLING_MISCONFIGURED' };
    }
    if (practice.subscriptionStatus !== 'active' && practice.subscriptionStatus !== 'trialing') {
      return { allowed: false, reason: 'SUBSCRIPTION_CANCELED' };
    }
    if (practice.subscriptionPriceId) {
      const tierForPrice = billingTierForStripePrice(practice.subscriptionPriceId);
      if (tierForPrice !== practice.billingTier) {
        console.error(
          `[planGate] subscription price ${practice.subscriptionPriceId} maps to tier=${tierForPrice ?? 'none'} ` +
            `but practice=${practice.id} is on tier=${practice.billingTier} — blocking until reconciled`,
        );
        return { allowed: false, reason: 'BILLING_MISCONFIGURED' };
      }
    }
  }

  if (practice.callsPaused) {
    switch (practice.callsPausedReason) {
      case 'payment_failed':
        return { allowed: false, reason: 'SUBSCRIPTION_PAST_DUE' };
      case 'subscription_cancelled':
        return { allowed: false, reason: 'SUBSCRIPTION_CANCELED' };
      case 'cogs_breaker':
        return { allowed: false, reason: 'COGS_BREAKER_PAUSED' };
      default:
        return { allowed: false, reason: 'OVERAGE_PENDING', overageRatePerMinute: tier.overageRatePerMinute };
    }
  }

  if (tier.dailyCapMinutes != null) {
    const todayMinutes = await getTodayMinutes(prisma, practiceId);
    if (todayMinutes >= tier.dailyCapMinutes) {
      return { allowed: false, reason: 'DAILY_CAP_REACHED' };
    }
  }

  const usage = await getOrCreateUsagePeriod(prisma, practice);
  const inOverage = usage.minutesConsumed >= tier.includedMinutes;
  if (inOverage) {
    if (tier.hardStopAtLimit) {
      return { allowed: false, reason: 'TRIAL_LIMIT_REACHED' };
    }
    if (!practice.overageConfirmed) {
      await triggerSoftStop(prisma, practice);
      return { allowed: false, reason: 'OVERAGE_PENDING', overageRatePerMinute: tier.overageRatePerMinute };
    }
    // Confirmed overage still runs through the COGS breaker below — unlimited
    // confirmed-overage minutes must not be exempt from a cost check just
    // because the practice said yes to the rate. evaluateCogsBreaker compares
    // against revenue collected so far (price + overage charges), not the
    // flat subscription price, so this stays meaningful past includedMinutes.
  }

  const cogs = evaluateCogsBreaker(tier, usage.minutesConsumed);
  const overageRatePerMinute = inOverage ? tier.overageRatePerMinute : undefined;

  if (cogs === 'pause') {
    await pauseCalls(prisma, practice.id, 'cogs_breaker');
    console.error(
      `[cogsBreaker] delivery cost crossed ${Math.round(COGS_BREAKER.pauseAtPctOfPrice * 100)}% ` +
        `of revenue collected — pausing calls for practice=${practice.id} ` +
        `(${usage.minutesConsumed} min consumed on ${practice.billingTier})`,
    );
    try {
      const { dispatchOpsAlert } = await import('../observability/opsAlerts.js');
      await dispatchOpsAlert({
        alertId: 'cogs_breaker',
        source: practice.id,
        detail: `${usage.minutesConsumed} min consumed on ${practice.billingTier} tier`,
      });
    } catch (alertErr) {
      console.error('[cogsBreaker] ops alert dispatch failed (non-fatal):', alertErr);
    }
    return { allowed: false, reason: 'COGS_BREAKER_PAUSED' };
  }
  if (cogs === 'throttle') {
    return { allowed: true, reason: 'OK', essentialOnly: true, overageRatePerMinute };
  }

  return { allowed: true, reason: 'OK', overageRatePerMinute };
}

/**
 * Month-to-date delivery cost as a fraction of REVENUE — base subscription
 * price, plus overage-rate revenue for any minutes already beyond the
 * included pool. Structural guarantee that no practice can become
 * unprofitable: at the throttle threshold only high-value calls dispatch;
 * at the pause threshold calling stops until the billing cycle resets
 * (startNewBillingCycle clears the pause) or an operator intervenes.
 *
 * Comparing cost against the flat subscription price alone (as this
 * function did previously) made it structurally unreachable once
 * minutesConsumed passed includedMinutes: every tier is priced so 100% of
 * included minutes costs only ~20% of price (that's the ~80% margin), while
 * the throttle/pause thresholds are 40%/60% — mathematically impossible to
 * cross within the included-minutes zone. The breaker was only ever called
 * in exactly that unreachable zone (see evaluateCallGate below, which used
 * to skip this function entirely once a practice confirmed overage) — a
 * practice burning unlimited confirmed-overage minutes had no cost check at
 * all. Using revenue-so-far instead of the flat price keeps the same
 * behavior for in-plan usage (overageMinutes is 0, so revenue === tier.price
 * exactly) while making the breaker meaningful in the overage zone too.
 */
export function evaluateCogsBreaker(
  tier: TierConfig,
  minutesConsumed: number,
): 'ok' | 'throttle' | 'pause' {
  if (tier.price <= 0) return 'ok';
  const deliveryCost = minutesConsumed * UNIT_ECONOMICS.costPerMinute;
  const overageMinutes = Math.max(0, minutesConsumed - tier.includedMinutes);
  const revenue = tier.price + overageMinutes * (tier.overageRatePerMinute ?? 0);
  if (deliveryCost >= revenue * COGS_BREAKER.pauseAtPctOfPrice) return 'pause';
  if (deliveryCost >= revenue * COGS_BREAKER.throttleAtPctOfPrice) return 'throttle';
  return 'ok';
}

/**
 * Record minutes for a completed call. Looks up the CallAttempt by vapiCallId,
 * computes minutesBilled = ceil(durationSeconds / 60), and applies it to the
 * practice's current UsagePeriod. Idempotent — a CallAttempt with minutesBilled
 * already set is a no-op (handles redelivered webhooks).
 */
export async function recordCallUsage(
  prisma: PrismaClient,
  opts: { practiceId: string; vapiCallId: string },
): Promise<{ recorded: boolean; minutesBilled?: number }> {
  const attempt = await prisma.callAttempt.findUnique({ where: { vapiCallId: opts.vapiCallId } });
  if (!attempt || attempt.durationSeconds == null) {
    return { recorded: false };
  }
  if (attempt.minutesBilled != null) {
    return { recorded: false };
  }

  const practice = await prisma.practice.findUnique({ where: { id: opts.practiceId } });
  if (!practice) {
    return { recorded: false };
  }

  // Org-billed practices must record into the org-aligned UsagePeriod window
  // (not their own, always-trial billingTier/trialEndsAt window) — otherwise
  // evaluateOrgCallGate's pooled sum silently misses minutes recorded here.
  const billingEntity = await resolveBillingEntity(prisma, opts.practiceId);
  const org =
    billingEntity.kind === 'organization'
      ? await prisma.organization.findUnique({ where: { id: billingEntity.organizationId } })
      : null;
  const pooled = Boolean(org?.cogsPoolingEnabled);

  const minutesBilled = Math.max(1, Math.ceil(attempt.durationSeconds / 60));
  const usage =
    pooled && org
      ? await getOrCreateOrgAlignedUsagePeriod(prisma, opts.practiceId, org)
      : await getOrCreateUsagePeriod(prisma, practice);

  await prisma.$transaction([
    prisma.callAttempt.update({ where: { id: attempt.id }, data: { minutesBilled } }),
    prisma.usagePeriod.update({
      where: { id: usage.id },
      data: { minutesConsumed: { increment: minutesBilled }, callsCompleted: { increment: 1 } },
    }),
  ]);

  const updated = await prisma.usagePeriod.findUnique({ where: { id: usage.id } });
  const tier = pooled && org ? TIERS[org.billingTier ?? 'trial'] : tierFor(practice);

  await maybeDispatchDailySpendAlert(prisma, practice, tier, minutesBilled);

  // NOTE: this compares one practice's own minutesConsumed against the pooled
  // org tier's full allowance, so it under-triggers for a busy multi-practice
  // org (evaluateOrgCallGate — the authoritative dispatch gate — always sums
  // correctly across every member practice regardless). Org-level pooled
  // warning/soft-stop-on-write dedup is a follow-up, not a dispatch-safety gap.
  if (updated && updated.minutesConsumed >= tier.includedMinutes) {
    if (!tier.hardStopAtLimit) {
      if (pooled && org && !org.overageConfirmed) {
        await pauseOrgCalls(prisma, org.id, 'overage_pending');
      } else if (!pooled && !practice.overageConfirmed) {
        await triggerSoftStop(prisma, practice);
      }
    }
  } else if (updated && !updated.warning80Sent) {
    const pct = tier.includedMinutes > 0 ? updated.minutesConsumed / tier.includedMinutes : 0;
    if (pct >= WARNINGS.usagePercentThreshold) {
      await prisma.usagePeriod.update({ where: { id: updated.id }, data: { warning80Sent: true } });
    }
  }

  return { recorded: true, minutesBilled };
}

/**
 * Alert ops when one day's usage crosses CALL_TIMEOUTS.dailySpendAlertPct of
 * the monthly allowance. Crossing detection (before < threshold <= after)
 * keeps the alert to at most once per crossing without a dedup table.
 */
async function maybeDispatchDailySpendAlert(
  prisma: PrismaClient,
  practice: Practice,
  tier: TierConfig,
  minutesJustBilled: number,
): Promise<void> {
  if (tier.includedMinutes <= 0) return;
  const thresholdMinutes = tier.includedMinutes * CALL_TIMEOUTS.dailySpendAlertPct;
  const todayAfter = await getTodayMinutes(prisma, practice.id);
  const todayBefore = todayAfter - minutesJustBilled;
  if (todayBefore >= thresholdMinutes || todayAfter < thresholdMinutes) return;

  console.error(
    `[dailySpendAlert] practice=${practice.id} burned ${todayAfter} min today — ` +
      `over ${Math.round(CALL_TIMEOUTS.dailySpendAlertPct * 100)}% of the ${tier.includedMinutes}-min monthly allowance in one day`,
  );
  try {
    const { dispatchOpsAlert } = await import('../observability/opsAlerts.js');
    await dispatchOpsAlert({
      alertId: 'daily_spend',
      source: practice.id,
      detail: `${todayAfter} min in one day on ${practice.billingTier} (monthly allowance ${tier.includedMinutes} min)`,
    });
  } catch (alertErr) {
    console.error('[dailySpendAlert] ops alert dispatch failed (non-fatal):', alertErr);
  }
}

/**
 * Practice confirms overage charges from the Usage tab — resumes calling.
 * No-op if the practice isn't in an overage_pending soft stop. The offer
 * auto-declines after OVERAGE.confirmationExpiryHours — late confirmations
 * are rejected and calling stays paused until upgrade or cycle reset.
 */
export async function confirmOverage(
  prisma: PrismaClient,
  practiceId: string,
): Promise<{ status: 'resumed' | 'not_paused' | 'expired' }> {
  const practice = await prisma.practice.findUnique({ where: { id: practiceId } });
  if (!practice?.callsPaused || practice.callsPausedReason !== 'overage_pending') {
    return { status: 'not_paused' };
  }
  if (practice.callsPausedAt) {
    const expiresAt = practice.callsPausedAt.getTime() + OVERAGE.confirmationExpiryHours * 60 * 60 * 1000;
    if (Date.now() > expiresAt) {
      return { status: 'expired' };
    }
  }
  await prisma.practice.update({
    where: { id: practiceId },
    data: {
      callsPaused: false,
      callsPausedReason: null,
      callsPausedAt: null,
      overageConfirmed: true,
      overageConfirmedAt: new Date(),
    },
  });
  return { status: 'resumed' };
}

/**
 * Org-level equivalent of confirmOverage — resumes the whole pooled org's
 * calling after an org_admin accepts overage charges from the Group Dashboard.
 * evaluateOrgCallGate is the only writer of callsPausedReason='overage_pending'
 * on Organization, so this mirrors confirmOverage's practice-level contract.
 */
export async function confirmOrgOverage(
  prisma: PrismaClient,
  organizationId: string,
): Promise<{ status: 'resumed' | 'not_paused' | 'expired' }> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org?.callsPaused || org.callsPausedReason !== 'overage_pending') {
    return { status: 'not_paused' };
  }
  if (org.callsPausedAt) {
    const expiresAt = org.callsPausedAt.getTime() + OVERAGE.confirmationExpiryHours * 60 * 60 * 1000;
    if (Date.now() > expiresAt) {
      return { status: 'expired' };
    }
  }
  await prisma.organization.update({
    where: { id: organizationId },
    data: {
      callsPaused: false,
      callsPausedReason: null,
      callsPausedAt: null,
      overageConfirmed: true,
      overageConfirmedAt: new Date(),
    },
  });
  return { status: 'resumed' };
}

/**
 * Start a fresh UsagePeriod at billing-cycle renewal (Stripe invoice.paid).
 * Clears any pause that was waiting on this cycle's reset.
 */
export async function startNewBillingCycle(prisma: PrismaClient, practiceId: string): Promise<void> {
  const practice = await prisma.practice.findUnique({ where: { id: practiceId } });
  if (!practice) return;

  const periodStart = new Date();
  const periodEnd = practice.subscriptionCurrentPeriodEnd ?? addMonths(periodStart, 1);

  await prisma.$transaction([
    prisma.usagePeriod.create({ data: { practiceId, periodStart, periodEnd } }),
    prisma.practice.update({
      where: { id: practiceId },
      data: {
        billingPeriodStart: periodStart,
        callsPaused: false,
        callsPausedReason: null,
        callsPausedAt: null,
        overageConfirmed: false,
        overageConfirmedAt: null,
      },
    }),
  ]);
}

/**
 * Org-level equivalent of startNewBillingCycle — resets every member
 * practice's UsagePeriod to a fresh window aligned to the org's Stripe
 * cycle, since pooled usage (evaluateOrgCallGate) sums across all of them.
 */
export async function startNewOrgBillingCycle(prisma: PrismaClient, organizationId: string): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) return;

  const periodStart = new Date();
  const periodEnd = org.subscriptionCurrentPeriodEnd ?? addMonths(periodStart, 1);

  const members = await prisma.organizationPractice.findMany({
    where: { organizationId },
    select: { practiceId: true },
  });

  await prisma.$transaction([
    ...members.map((m) =>
      prisma.usagePeriod.create({ data: { practiceId: m.practiceId, periodStart, periodEnd } }),
    ),
    prisma.organization.update({
      where: { id: organizationId },
      data: {
        billingPeriodStart: periodStart,
        callsPaused: false,
        callsPausedReason: null,
        callsPausedAt: null,
        overageConfirmed: false,
        overageConfirmedAt: null,
      },
    }),
  ]);
}

/** Org-level equivalent of syncSubscriptionHealth — pauses/resumes the whole org. */
export async function syncOrgSubscriptionHealth(
  prisma: PrismaClient,
  organizationId: string,
  subscriptionStatus: string | null | undefined,
): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) return;

  if (subscriptionStatus === 'past_due' || subscriptionStatus === 'unpaid') {
    await prisma.organization.updateMany({
      where: { id: organizationId, callsPaused: false },
      data: { callsPaused: true, callsPausedReason: 'payment_failed', callsPausedAt: new Date() },
    });
    return;
  }

  if (subscriptionStatus === 'canceled') {
    await prisma.organization.update({
      where: { id: organizationId },
      data: { callsPaused: true, callsPausedReason: 'subscription_cancelled', callsPausedAt: new Date() },
    });
    return;
  }

  if (
    (subscriptionStatus === 'active' || subscriptionStatus === 'trialing') &&
    org.callsPaused &&
    (org.callsPausedReason === 'payment_failed' || org.callsPausedReason === 'subscription_cancelled')
  ) {
    await prisma.organization.update({
      where: { id: organizationId },
      data: { callsPaused: false, callsPausedReason: null, callsPausedAt: null },
    });
  }
}

/**
 * Reflect Stripe subscription health on the call gate. Tier selection
 * (core/growth/scale) happens separately — this only pauses/resumes calling
 * based on payment status.
 */
export async function syncSubscriptionHealth(
  prisma: PrismaClient,
  practiceId: string,
  subscriptionStatus: string | null | undefined,
): Promise<void> {
  const practice = await prisma.practice.findUnique({ where: { id: practiceId } });
  if (!practice) return;

  if (subscriptionStatus === 'past_due' || subscriptionStatus === 'unpaid') {
    await pauseCalls(prisma, practiceId, 'payment_failed');
    return;
  }

  if (subscriptionStatus === 'canceled') {
    await prisma.practice.update({
      where: { id: practiceId },
      data: {
        billingTier: 'trial',
        callsPaused: true,
        callsPausedReason: 'subscription_cancelled',
        callsPausedAt: new Date(),
      },
    });
    return;
  }

  if (
    (subscriptionStatus === 'active' || subscriptionStatus === 'trialing') &&
    practice.callsPaused &&
    (practice.callsPausedReason === 'payment_failed' || practice.callsPausedReason === 'subscription_cancelled')
  ) {
    await prisma.practice.update({
      where: { id: practiceId },
      data: { callsPaused: false, callsPausedReason: null, callsPausedAt: null },
    });
  }
}

export type UsageSnapshot = {
  practice: Practice;
  tier: TierConfig;
  usage: UsagePeriod;
  todayMinutes: number;
  lifetimeRecoveredCents: number;
};

export async function getUsageSnapshot(prisma: PrismaClient, practiceId: string): Promise<UsageSnapshot | null> {
  const practice = await prisma.practice.findUnique({ where: { id: practiceId } });
  if (!practice) return null;

  const tier = tierFor(practice);
  const [usage, todayMinutes, resolvedClaims] = await Promise.all([
    getOrCreateUsagePeriod(prisma, practice),
    getTodayMinutes(prisma, practiceId),
    prisma.insuranceClaim.findMany({
      where: { practiceId, status: 'RESOLVED' },
      select: { billedAmount: true, outstandingAmount: true },
    }),
  ]);

  // Recovered = billedAmount - outstandingAmount, NOT outstandingAmount
  // itself: transitionClaimRecovery.ts zeroes outstandingAmount as part of
  // the RESOLVED transition, so summing outstandingAmount here always
  // yielded 0 regardless of how much was actually recovered. Reproduced
  // live on /billing: "Lifetime AR recovered: $0.00" for a practice whose
  // 25 resolved claims actually totaled $41,270 recovered. Matches the
  // same billedAmount-minus-outstandingAmount formula already used
  // correctly for this exact metric in analytics.ts's practice-performance
  // route.
  const lifetimeRecovered = resolvedClaims.reduce(
    (sum, c) => sum + Math.max(0, Number(c.billedAmount) - Number(c.outstandingAmount)),
    0,
  );
  const lifetimeRecoveredCents = Math.round(lifetimeRecovered * 100);

  return { practice, tier, usage, todayMinutes, lifetimeRecoveredCents };
}

export async function recoveredCentsForClaim(prisma: PrismaClient, claimId: string): Promise<number> {
  if (!claimId) return 0;
  const claim = await prisma.insuranceClaim.findUnique({ where: { id: claimId }, select: { outstandingAmount: true } });
  const amt = claim ? Number(claim.outstandingAmount) : NaN;
  return Number.isFinite(amt) ? Math.round(amt * 100) : 0;
}
