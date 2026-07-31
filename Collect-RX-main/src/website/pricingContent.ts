import type { BillingTier } from '@prisma/client';
import { TIERS } from '../billing/tiers';

/** Staff-equivalent minutes per carrier follow-up call (marketing / ROI framing). */
export const STAFF_EQUIV_MINUTES_PER_CALL = 50;
/** Burdened hourly cost for front-desk / biller time (CAD). */
export const STAFF_BURDENED_HOURLY_CAD = 52;

export const PAID_TIER_ORDER = ['core', 'growth', 'scale'] as const satisfies readonly BillingTier[];

export type PaidTierId = (typeof PAID_TIER_ORDER)[number];

/** Illustrative monthly call volume at typical usage — not a guarantee. */
export const TIER_ILLUSTRATIVE_CALLS: Record<PaidTierId, number> = {
  core: 70,
  growth: 165,
  scale: 230,
};

export const MARKETING_TIER_FEATURES: Record<PaidTierId, string[]> = {
  core: [
    'All 6 Canadian carriers',
    '3 attempts per claim',
    'Command center dashboard',
    'Verified recovery tracking',
    'Email escalation alerts',
    '100 minutes/day cap',
  ],
  growth: [
    'Everything in Core',
    'SMS + email alerts',
    'Priority queue management',
    'Weekly AR summary',
    '300 minutes/day cap',
  ],
  scale: [
    'Everything in Growth',
    'No daily minute cap',
    'Multi-location support',
    'Audit trail export',
    'Founder-priority support',
    '$0.20/min overage (vs $0.25)',
  ],
};

export function illustrativeStaffSavingsCAD(callsPerMonth: number): number {
  const hours = (callsPerMonth * STAFF_EQUIV_MINUTES_PER_CALL) / 60;
  return Math.round(hours * STAFF_BURDENED_HOURLY_CAD);
}

export function paidTierCards() {
  return PAID_TIER_ORDER.map((id) => {
    const tier = TIERS[id];
    const calls = TIER_ILLUSTRATIVE_CALLS[id];
    return {
      id,
      name: tier.name,
      price: tier.price,
      includedMinutes: tier.includedMinutes,
      overageRate: tier.overageRatePerMinute,
      dailyCapMinutes: tier.dailyCapMinutes,
      targetCustomer: tier.targetCustomer ?? '',
      description: tier.description,
      features: MARKETING_TIER_FEATURES[id],
      illustrativeStaffSavings: illustrativeStaffSavingsCAD(calls),
      illustrativeCalls: calls,
      highlight: id === 'growth',
    };
  });
}

export function fmtCad(amount: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(amount);
}
