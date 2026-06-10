/**
 * TypeScript bridge to the CJS plan / usage services.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const planService = require('../../services/plans/planService.cjs') as any;
const usageService = require('../../services/plans/usageService.cjs') as any;
const { getFeatures: featuresForTier } = require('../../services/plans/tierFeatures.cjs') as any;

export type PlanGateReason =
  | 'OK'
  | 'OVERAGE'
  | 'TRIAL_LIMIT_REACHED'
  | 'PLAN_LIMIT_REACHED'
  | 'SUBSCRIPTION_PAST_DUE'
  | 'SUBSCRIPTION_CANCELED';

export type PlanGateResult = {
  allowed: boolean;
  reason: PlanGateReason;
  overageCentsPerClaim?: number | null;
};

export type UsageAlertLevel = 'info' | 'warning' | 'critical';

export type UsageAlert = {
  level: UsageAlertLevel;
  code: string;
  message: string;
  progress?: number;
};

export type PlanSummary = {
  [key: string]: unknown;
  alerts: UsageAlert[];
  cycleEndsAt?: string | null;
  cycle?: { startedAt?: string };
  status?: string;
  trial?: { progress: number; recoveredCents: number; thresholdCents: number };
  features?: { includedResolvedClaimsPerCycle?: number; allowOverage?: boolean; overageCentsPerClaim?: number; usageUnitLabel?: string };
};

export async function canMakeCall(practiceId: string): Promise<PlanGateResult> {
  const gate = await planService.canMakeCall(practiceId);
  const features = featuresForTier(gate.plan.tier);
  return {
    allowed: gate.allowed,
    reason: gate.reason as PlanGateReason,
    overageCentsPerClaim: features.overageCentsPerClaim ?? null,
  };
}

export function gateBlockMessage(reason: PlanGateReason, overageCentsPerClaim?: number | null): string {
  const overageFee =
    overageCentsPerClaim != null && overageCentsPerClaim > 0
      ? `$${(overageCentsPerClaim / 100).toFixed(2)}`
      : null;

  switch (reason) {
    case 'TRIAL_LIMIT_REACHED':
      return 'Your trial recovery limit has been reached. Subscribe to continue resolving claims.';
    case 'PLAN_LIMIT_REACHED':
      return 'Your included claims for this billing cycle are used up. Upgrade your plan to keep CollectRx working your AR.';
    case 'SUBSCRIPTION_PAST_DUE':
      return 'Your subscription payment is past due. Update billing to resume claim resolution.';
    case 'SUBSCRIPTION_CANCELED':
      return 'Your subscription is canceled. Resubscribe to resume claim resolution.';
    case 'OVERAGE':
      return overageFee
        ? `You are past your included claims this cycle. CollectRx continues working AR at ${overageFee} per additional claim resolved (billed on your next invoice).`
        : 'You are past your included claims this cycle. Additional usage may be billed.';
    default:
      return '';
  }
}

export function formatOverageRate(cents: number | null | undefined): string | null {
  if (cents == null || cents <= 0) return null;
  return `$${(cents / 100).toFixed(2)} per claim`;
}

export async function getPlanSummary(
  practiceId: string,
  cycleEndsAt?: Date | null,
): Promise<PlanSummary> {
  const summary = await planService.getPlanSummary(practiceId);
  return {
    ...summary,
    cycleEndsAt: cycleEndsAt?.toISOString() ?? null,
    alerts: computeUsageAlerts(summary),
  };
}

export function computeUsageAlerts(
  summary: Awaited<ReturnType<typeof planService.getPlanSummary>>,
): UsageAlert[] {
  const alerts: UsageAlert[] = [];

  if (summary.status === 'past_due') {
    alerts.push({
      level: 'critical',
      code: 'SUBSCRIPTION_PAST_DUE',
      message: 'Payment is past due — carrier calls are paused until billing is updated.',
    });
    return alerts;
  }

  if (summary.status === 'canceled') {
    alerts.push({
      level: 'critical',
      code: 'SUBSCRIPTION_CANCELED',
      message: 'Subscription canceled — subscribe again to resume carrier calls.',
    });
    return alerts;
  }

  if (summary.status === 'trial') {
    const pct = summary.trial.progress;
    if (pct >= 1) {
      alerts.push({
        level: 'critical',
        code: 'TRIAL_LIMIT_REACHED',
        message: 'Trial recovery limit reached — subscribe to keep calling.',
        progress: pct,
      });
    } else if (pct >= 0.95) {
      alerts.push({
        level: 'warning',
        code: 'TRIAL_95',
        message: `Trial is almost complete — $${(summary.trial.recoveredCents / 100).toFixed(0)} of $${(summary.trial.thresholdCents / 100).toFixed(0)} recovered.`,
        progress: pct,
      });
    } else if (pct >= 0.8) {
      alerts.push({
        level: 'info',
        code: 'TRIAL_80',
        message: `Trial is ${Math.round(pct * 100)}% used — $${(summary.trial.recoveredCents / 100).toFixed(0)} recovered so far.`,
        progress: pct,
      });
    }
    return alerts;
  }

  const { cycle, features } = summary;
  const unit = features.usageUnitLabel || 'claims resolved';
  const overageRate = formatOverageRate(features.overageCentsPerClaim);
  const softLimit = features.allowOverage;

  if (features.includedResolvedClaimsPerCycle != null && features.includedResolvedClaimsPerCycle > 0) {
    pushPoolAlerts(
      alerts,
      'resolved_claims',
      cycle.resolvedClaimsUsed,
      features.includedResolvedClaimsPerCycle,
      unit,
      !softLimit,
      overageRate,
    );
  }

  return alerts;
}

function pushPoolAlerts(
  alerts: UsageAlert[],
  prefix: string,
  used: number,
  limit: number,
  label: string,
  hardBlock: boolean,
  overageRate: string | null,
): void {
  const pct = limit > 0 ? used / limit : 0;
  const remaining = Math.max(0, limit - used);
  const overageSuffix = overageRate
    ? ` Additional ${label} are billed at ${overageRate}.`
    : '';
  const allowsOverage = !hardBlock;

  if (pct >= 1) {
    alerts.push({
      level: 'critical',
      code: `${prefix}_100`,
      message: hardBlock
        ? `Included ${label} exhausted (${used}/${limit}) — CollectRx is paused until your cycle resets or you upgrade.`
        : `Included ${label} used up (${used}/${limit}). CollectRx keeps working your AR.${overageSuffix} Charges appear on your next invoice.`,
      progress: pct,
    });
  } else if (pct >= 0.95) {
    alerts.push({
      level: 'warning',
      code: `${prefix}_95`,
      message: allowsOverage
        ? `Almost at your included ${label} — ${remaining} left this cycle.${overageSuffix}`
        : `Almost at your included ${label} — ${remaining} left before CollectRx pauses.`,
      progress: pct,
    });
  } else if (pct >= 0.8) {
    alerts.push({
      level: allowsOverage ? 'warning' : 'info',
      code: `${prefix}_80`,
      message: allowsOverage
        ? `${Math.round(pct * 100)}% of included ${label} used (${used}/${limit}).${overageSuffix}`
        : `${Math.round(pct * 100)}% of included ${label} used (${used}/${limit}).`,
      progress: pct,
    });
  }
}

export async function recordCallUsage(opts: {
  practiceId: string;
  claimId: string;
  vapiCallId: string;
  outcomeCode: string;
  amountCents?: number;
}): Promise<{ recorded: boolean; eventType?: string; reason?: string }> {
  return usageService.recordOutcome(opts);
}

export async function recoveredCentsForClaim(claimId: string): Promise<number> {
  return usageService.recoveredCentsForClaim(claimId);
}

export async function startNewBillingCycle(practiceId: string): Promise<void> {
  await usageService.startNewCycle(practiceId);
}

export async function syncPlanStatusFromSubscription(
  practiceId: string,
  subscriptionStatus: string | null | undefined,
  tier = 'professional',
): Promise<void> {
  if (subscriptionStatus === 'active' || subscriptionStatus === 'trialing') {
    await planService.setTier(practiceId, tier, 'active');
    return;
  }
  if (subscriptionStatus === 'past_due' || subscriptionStatus === 'unpaid') {
    await planService.setTier(practiceId, tier, 'past_due');
    return;
  }
  if (subscriptionStatus === 'canceled') {
    await planService.setTier(practiceId, tier, 'canceled');
  }
}

export { planService, usageService };
