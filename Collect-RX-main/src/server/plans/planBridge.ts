/**
 * Plan/usage bridge — minutes-based billing (src/billing/tiers.ts, UsagePeriod).
 *
 * canMakeCall()/recordCallUsage() are the stable interface consumed by the
 * live call queue (queueEngine.ts) and the Vapi webhook processor
 * (vapiDeskEvents.ts) — signatures here must stay compatible with those
 * call sites.
 */
import { prisma } from '../../lib/prisma.js';
import { WARNINGS } from '../../billing/tiers.js';
import {
  confirmOverage as confirmOverageUsage,
  evaluateCallGate,
  getUsageSnapshot,
  recordCallUsage as recordCallUsageInternal,
  recoveredCentsForClaim as recoveredCentsForClaimInternal,
  startNewBillingCycle as startNewBillingCycleInternal,
  syncSubscriptionHealth,
  type PlanGateReason,
  type PlanGateResult,
} from './usagePeriodService.js';

export type { PlanGateReason, PlanGateResult };

export type UsageAlertLevel = 'info' | 'warning' | 'critical';

export type UsageAlert = {
  level: UsageAlertLevel;
  code: string;
  message: string;
  progress?: number;
};

export type PlanSummary = {
  practiceId: string;
  tier: string;
  tierName: string;
  status: string;
  callsPaused: boolean;
  callsPausedReason: string | null;
  cycle: {
    startedAt: string;
    endsAt: string | null;
    minutesConsumed: number;
    minutesIncluded: number;
    minutesRemaining: number;
    usagePercent: number;
    callsCompleted: number;
    dailyMinutesConsumed: number;
    dailyCapMinutes: number | null;
  };
  trial: {
    active: boolean;
    endsAt: string | null;
    daysRemaining: number | null;
  };
  overage: {
    ratePerMinute: number | null;
    confirmed: boolean;
  };
  lifetime: { recoveredCents: number };
  alerts: UsageAlert[];
  cycleEndsAt?: string | null;
};

export async function canMakeCall(practiceId: string): Promise<PlanGateResult> {
  return evaluateCallGate(prisma, practiceId);
}

export function formatOverageRate(ratePerMinute: number | null | undefined): string | null {
  if (ratePerMinute == null || ratePerMinute <= 0) return null;
  return `$${ratePerMinute.toFixed(2)}/min`;
}

export function gateBlockMessage(reason: PlanGateReason, overageRatePerMinute?: number | null): string {
  switch (reason) {
    case 'TRIAL_LIMIT_REACHED':
      return 'Your trial has ended. Subscribe to a plan to keep CollectRx calling carriers.';
    case 'OVERAGE_PENDING': {
      const rate = formatOverageRate(overageRatePerMinute);
      return `Monthly minutes exhausted. Confirm overage charges${rate ? ` (${rate})` : ''} to resume calling.`;
    }
    case 'DAILY_CAP_REACHED':
      return 'Daily calling limit reached. CollectRx resumes automatically tomorrow.';
    case 'SUBSCRIPTION_PAST_DUE':
      return 'Your subscription payment is past due. Update billing to resume calling.';
    case 'SUBSCRIPTION_CANCELED':
      return 'Your subscription is canceled. Resubscribe to resume calling.';
    default:
      return '';
  }
}

export async function getPlanSummary(practiceId: string, cycleEndsAt?: Date | null): Promise<PlanSummary> {
  const snapshot = await getUsageSnapshot(prisma, practiceId);
  if (!snapshot) {
    throw new Error(`Practice not found: ${practiceId}`);
  }
  const { practice, tier, usage, todayMinutes, lifetimeRecoveredCents } = snapshot;
  const now = new Date();

  const minutesIncluded = tier.includedMinutes;
  const minutesConsumed = usage.minutesConsumed;
  const minutesRemaining = Math.max(0, minutesIncluded - minutesConsumed);
  const usagePercent = minutesIncluded > 0 ? Math.min(1, minutesConsumed / minutesIncluded) : 0;

  const trialActive = practice.billingTier === 'trial';
  const trialEndsAt = practice.trialEndsAt ?? null;
  const trialDaysRemaining =
    trialActive && trialEndsAt
      ? Math.ceil((trialEndsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
      : null;

  const summary: PlanSummary = {
    practiceId,
    tier: practice.billingTier,
    tierName: tier.name,
    status: practice.subscriptionStatus ?? (trialActive ? 'trial' : 'active'),
    callsPaused: practice.callsPaused,
    callsPausedReason: practice.callsPausedReason,
    cycle: {
      startedAt: usage.periodStart.toISOString(),
      endsAt: usage.periodEnd?.toISOString() ?? null,
      minutesConsumed,
      minutesIncluded,
      minutesRemaining,
      usagePercent,
      callsCompleted: usage.callsCompleted,
      dailyMinutesConsumed: todayMinutes,
      dailyCapMinutes: tier.dailyCapMinutes,
    },
    trial: {
      active: trialActive,
      endsAt: trialEndsAt?.toISOString() ?? null,
      daysRemaining: trialDaysRemaining,
    },
    overage: {
      ratePerMinute: tier.overageRatePerMinute,
      confirmed: practice.overageConfirmed,
    },
    lifetime: { recoveredCents: lifetimeRecoveredCents },
    alerts: [],
    cycleEndsAt: (cycleEndsAt ?? practice.subscriptionCurrentPeriodEnd)?.toISOString() ?? null,
  };

  summary.alerts = computeUsageAlerts(summary);
  return summary;
}

export function computeUsageAlerts(summary: PlanSummary): UsageAlert[] {
  const alerts: UsageAlert[] = [];

  if (summary.callsPausedReason === 'subscription_cancelled') {
    alerts.push({
      level: 'critical',
      code: 'subscription_cancelled',
      message: 'Subscription canceled — calls are paused. Subscribe again to resume.',
    });
    return alerts;
  }

  if (summary.callsPausedReason === 'payment_failed') {
    alerts.push({
      level: 'critical',
      code: 'payment_failed',
      message: 'Payment failed — calls are paused until billing is updated.',
    });
    return alerts;
  }

  if (summary.trial.active) {
    const expired = summary.trial.endsAt ? new Date(summary.trial.endsAt) < new Date() : false;
    if (expired || summary.cycle.usagePercent >= 1) {
      alerts.push({
        level: 'critical',
        code: 'TRIAL_LIMIT_REACHED',
        message: 'Trial limit reached — subscribe to keep CollectRx calling carriers.',
        progress: summary.cycle.usagePercent,
      });
    } else if (summary.trial.daysRemaining != null && summary.trial.daysRemaining <= 3) {
      const days = summary.trial.daysRemaining;
      alerts.push({
        level: 'warning',
        code: 'trial_ending',
        message: `Your trial ends in ${days} day${days === 1 ? '' : 's'} — subscribe to continue.`,
      });
    }
    return alerts;
  }

  if (summary.callsPausedReason === 'overage_pending') {
    const rate = formatOverageRate(summary.overage.ratePerMinute);
    alerts.push({
      level: 'critical',
      code: 'usage_100',
      message: `Monthly minutes exhausted (${summary.cycle.minutesConsumed}/${summary.cycle.minutesIncluded}). Confirm overage charges${rate ? ` at ${rate}` : ''} to resume calling.`,
      progress: summary.cycle.usagePercent,
    });
    return alerts;
  }

  if (summary.cycle.usagePercent >= WARNINGS.usagePercentThreshold) {
    alerts.push({
      level: 'warning',
      code: 'usage_80',
      message: `${Math.round(summary.cycle.usagePercent * 100)}% of included minutes used (${summary.cycle.minutesConsumed}/${summary.cycle.minutesIncluded}).`,
      progress: summary.cycle.usagePercent,
    });
  } else if (summary.cycle.endsAt) {
    const daysUntilReset = Math.ceil((new Date(summary.cycle.endsAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    if (daysUntilReset >= 0 && daysUntilReset <= WARNINGS.daysBeforeResetThreshold && summary.cycle.usagePercent >= 0.5) {
      alerts.push({
        level: 'info',
        code: 'reset_approaching',
        message: `Your billing period resets in ${daysUntilReset} day${daysUntilReset === 1 ? '' : 's'}.`,
      });
    }
  }

  return alerts;
}

/** Record minutes for a completed call against the practice's current usage period. */
export async function recordCallUsage(opts: {
  practiceId: string;
  vapiCallId: string;
}): Promise<{ recorded: boolean; minutesBilled?: number }> {
  return recordCallUsageInternal(prisma, opts);
}

/** Practice confirms overage charges from the Usage tab — resumes calling. */
export async function confirmOverage(practiceId: string): Promise<{ status: 'resumed' | 'not_paused' }> {
  return confirmOverageUsage(prisma, practiceId);
}

export async function recoveredCentsForClaim(claimId: string): Promise<number> {
  return recoveredCentsForClaimInternal(prisma, claimId);
}

export async function startNewBillingCycle(practiceId: string): Promise<void> {
  await startNewBillingCycleInternal(prisma, practiceId);
}

export async function syncPlanStatusFromSubscription(
  practiceId: string,
  subscriptionStatus: string | null | undefined,
): Promise<void> {
  await syncSubscriptionHealth(prisma, practiceId, subscriptionStatus);
}
