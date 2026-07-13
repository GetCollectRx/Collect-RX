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
import type { Practice, PrismaClient, UsagePeriod } from '@prisma/client';
import { COGS_BREAKER, TIERS, UNIT_ECONOMICS, WARNINGS, type TierConfig } from '../../billing/tiers.js';

export type PlanGateReason =
  | 'OK'
  | 'TRIAL_LIMIT_REACHED'
  | 'OVERAGE_PENDING'
  | 'DAILY_CAP_REACHED'
  | 'SUBSCRIPTION_PAST_DUE'
  | 'SUBSCRIPTION_CANCELED'
  | 'COGS_BREAKER_PAUSED';

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

/**
 * The gate. Called by the queue dispatcher and manual-call routes BEFORE every dispatch.
 * Never throws — a missing practice is treated as a hard block.
 */
export async function evaluateCallGate(prisma: PrismaClient, practiceId: string): Promise<PlanGateResult> {
  const practice = await prisma.practice.findUnique({ where: { id: practiceId } });
  if (!practice) {
    return { allowed: false, reason: 'SUBSCRIPTION_CANCELED' };
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
  if (usage.minutesConsumed >= tier.includedMinutes) {
    if (tier.hardStopAtLimit) {
      return { allowed: false, reason: 'TRIAL_LIMIT_REACHED' };
    }
    // Confirmed overage: every further minute bills at the overage rate,
    // which exceeds delivery cost on all paid tiers — profitable, so neither
    // the soft stop nor the COGS breaker applies. Daily caps still do.
    if (practice.overageConfirmed) {
      return { allowed: true, reason: 'OK', overageRatePerMinute: tier.overageRatePerMinute };
    }
    await triggerSoftStop(prisma, practice);
    return { allowed: false, reason: 'OVERAGE_PENDING', overageRatePerMinute: tier.overageRatePerMinute };
  }

  const cogs = evaluateCogsBreaker(tier, usage.minutesConsumed);
  if (cogs === 'pause') {
    await pauseCalls(prisma, practice.id, 'cogs_breaker');
    console.error(
      `[cogsBreaker] delivery cost crossed ${Math.round(COGS_BREAKER.pauseAtPctOfPrice * 100)}% ` +
        `of subscription price — pausing calls for practice=${practice.id} ` +
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
    return { allowed: true, reason: 'OK', essentialOnly: true };
  }

  return { allowed: true, reason: 'OK' };
}

/**
 * Month-to-date delivery cost as a fraction of the subscription price.
 * Structural guarantee that no practice can become unprofitable: at the
 * throttle threshold only high-value calls dispatch; at the pause threshold
 * calling stops until the billing cycle resets (startNewBillingCycle clears
 * the pause) or an operator intervenes.
 */
export function evaluateCogsBreaker(
  tier: TierConfig,
  minutesConsumed: number,
): 'ok' | 'throttle' | 'pause' {
  if (tier.price <= 0) return 'ok';
  const deliveryCost = minutesConsumed * UNIT_ECONOMICS.costPerMinute;
  if (deliveryCost >= tier.price * COGS_BREAKER.pauseAtPctOfPrice) return 'pause';
  if (deliveryCost >= tier.price * COGS_BREAKER.throttleAtPctOfPrice) return 'throttle';
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

  const minutesBilled = Math.max(1, Math.ceil(attempt.durationSeconds / 60));
  const usage = await getOrCreateUsagePeriod(prisma, practice);

  await prisma.$transaction([
    prisma.callAttempt.update({ where: { id: attempt.id }, data: { minutesBilled } }),
    prisma.usagePeriod.update({
      where: { id: usage.id },
      data: { minutesConsumed: { increment: minutesBilled }, callsCompleted: { increment: 1 } },
    }),
  ]);

  const updated = await prisma.usagePeriod.findUnique({ where: { id: usage.id } });
  const tier = tierFor(practice);

  if (updated && updated.minutesConsumed >= tier.includedMinutes) {
    if (!tier.hardStopAtLimit && !practice.overageConfirmed) {
      await triggerSoftStop(prisma, practice);
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
 * Practice confirms overage charges from the Usage tab — resumes calling.
 * No-op if the practice isn't in an overage_pending soft stop.
 */
export async function confirmOverage(prisma: PrismaClient, practiceId: string): Promise<{ status: 'resumed' | 'not_paused' }> {
  const practice = await prisma.practice.findUnique({ where: { id: practiceId } });
  if (!practice?.callsPaused || practice.callsPausedReason !== 'overage_pending') {
    return { status: 'not_paused' };
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
  const [usage, todayMinutes, recovered] = await Promise.all([
    getOrCreateUsagePeriod(prisma, practice),
    getTodayMinutes(prisma, practiceId),
    prisma.insuranceClaim.aggregate({
      where: { practiceId, status: 'RESOLVED' },
      _sum: { outstandingAmount: true },
    }),
  ]);

  const lifetimeRecoveredCents = Math.round(Number(recovered._sum.outstandingAmount ?? 0) * 100);

  return { practice, tier, usage, todayMinutes, lifetimeRecoveredCents };
}

export async function recoveredCentsForClaim(prisma: PrismaClient, claimId: string): Promise<number> {
  if (!claimId) return 0;
  const claim = await prisma.insuranceClaim.findUnique({ where: { id: claimId }, select: { outstandingAmount: true } });
  const amt = claim ? Number(claim.outstandingAmount) : NaN;
  return Number.isFinite(amt) ? Math.round(amt * 100) : 0;
}
