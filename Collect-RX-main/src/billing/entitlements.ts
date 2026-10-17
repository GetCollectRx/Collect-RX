/**
 * Product tiers (founder decision 2026-10-06, ADR 0004): features unlock only
 * by upgrading the plan, never all at once.
 *
 *   Hold Sentinel (sentinel, and the trial): calls with staff handoff, AR
 *     dashboard, CSV import, and the CDCP tools, since CDCP is the entry point.
 *   Recovery (core, growth, scale): adds pre-visit eligibility for private
 *     carriers, non-CDCP denial evidence, and underpayment recovery.
 *   Autonomous (AI speaks with the rep): on no plan unless AUTONOMOUS_PLAN_TIERS
 *     names one, and then only per carrier after graduation (ADR 0005).
 *
 * Tier membership is data here; enforcement lives at the server boundary
 * (dispatch, routes), so hiding a button is never the only lock.
 */
import type { BillingTier } from '@prisma/client';

export const FEATURES = {
  HOLD_SENTINEL_CALLS: 'hold_sentinel_calls',
  CDCP_TOOLS: 'cdcp_tools',
  PRE_VISIT_ELIGIBILITY: 'pre_visit_eligibility',
  DENIAL_RECOVERY: 'denial_recovery',
  UNDERPAYMENT_RECOVERY: 'underpayment_recovery',
  AUTONOMOUS_CALLS: 'autonomous_calls',
} as const;

export type Feature = (typeof FEATURES)[keyof typeof FEATURES];

const BASE: readonly Feature[] = [FEATURES.HOLD_SENTINEL_CALLS, FEATURES.CDCP_TOOLS];
const RECOVERY: readonly Feature[] = [
  ...BASE,
  FEATURES.PRE_VISIT_ELIGIBILITY,
  FEATURES.DENIAL_RECOVERY,
  FEATURES.UNDERPAYMENT_RECOVERY,
];

export const TIER_FEATURES: Record<BillingTier, readonly Feature[]> = {
  trial: BASE,
  sentinel: BASE,
  core: RECOVERY,
  growth: RECOVERY,
  scale: RECOVERY,
};

export const FEATURE_LABELS: Record<Feature, string> = {
  hold_sentinel_calls: 'Hold Sentinel calls with staff handoff',
  cdcp_tools: 'CDCP predetermination and reconsideration tracking',
  pre_visit_eligibility: 'Pre-visit eligibility checks (private carriers)',
  denial_recovery: 'Denial evidence and resubmission tracking',
  underpayment_recovery: 'Underpayment recovery',
  autonomous_calls: 'Autonomous calling (CollectRx speaks with the rep)',
};

/** The cheapest plan that includes a feature, for "upgrade to X" messages. Null when no plan has it yet. */
export const FEATURE_UNLOCK_PLAN: Record<Feature, string | null> = {
  hold_sentinel_calls: 'Hold Sentinel',
  cdcp_tools: 'Hold Sentinel',
  pre_visit_eligibility: 'Recovery',
  denial_recovery: 'Recovery',
  underpayment_recovery: 'Recovery',
  autonomous_calls: null,
};

/**
 * Plans that include autonomous calling, from the comma-separated
 * AUTONOMOUS_PLAN_TIERS env var (for example "core,growth,scale"). Unset means
 * no plan, which is the ADR 0004 default. Opening a plan here is not enough on
 * its own: each carrier must also graduate (ADR 0005).
 */
export function autonomousPlanTiers(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env.AUTONOMOUS_PLAN_TIERS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function tierAllows(tier: BillingTier | null | undefined, feature: Feature): boolean {
  if (!tier) return false;
  if (feature === FEATURES.AUTONOMOUS_CALLS) return autonomousPlanTiers().has(tier);
  return TIER_FEATURES[tier].includes(feature);
}

export function featuresForTier(tier: BillingTier | null | undefined): Feature[] {
  return tier ? [...TIER_FEATURES[tier]] : [];
}

/**
 * Autonomous calling requires three things: a plan that includes it, the
 * practice's own setting, and (when the caller knows the carrier) a graduated
 * carrier (ADR 0005). Missing any one keeps the call on Hold Sentinel.
 */
export function effectiveHumanAssisted(
  tier: BillingTier | null | undefined,
  humanAssistedMode: boolean | undefined,
  options: { carrierGraduated?: boolean } = {},
): boolean {
  if (!tierAllows(tier, FEATURES.AUTONOMOUS_CALLS)) return true;
  if (options.carrierGraduated === false) return true;
  return humanAssistedMode !== false;
}

/**
 * A plan without autonomous calling keeps Hold Sentinel on. The value is
 * rewritten rather than rejected so a practice whose settings were saved as
 * false before plans existed can still save its other settings.
 */
export function settingsUpdateForPlan<T>(update: T, autonomousAllowed: boolean): T {
  if (autonomousAllowed || !update || typeof update !== 'object') return update;
  if ((update as { humanAssistedMode?: unknown }).humanAssistedMode !== false) return update;
  return { ...update, humanAssistedMode: true };
}

export function featureLockedMessage(feature: Feature): string {
  const plan = FEATURE_UNLOCK_PLAN[feature];
  return plan
    ? `This feature is included in the ${plan} plan. Upgrade on the Billing page to use it.`
    : 'This feature is not available on any plan yet.';
}
