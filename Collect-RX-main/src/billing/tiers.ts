/**
 * CollectRx Billing — Tier Definitions
 *
 * Real cost per minute delivered: ~$0.115
 * (Vapi $0.05 + GPT-5 Mini $0.02 + Deepgram Nova 3 $0.01 + Tara TTS $0.02 + Twilio $0.015 + hosting $0.01)
 *
 * Pricing targets ~78%+ gross margin on paid tiers at realistic usage.
 * Overage priced at $0.25/min (Core/Growth) and $0.20/min (Scale) — profitable above cost.
 *
 * Single source of truth for tier limits and pricing. Never hardcode these
 * values anywhere else — read from TIERS / WARNINGS / CALL_TIMEOUTS / OVERAGE.
 */

import type { BillingTier } from '@prisma/client';

// This module is imported by both server code and browser-bundled pages (e.g.
// LandingPage, ProductOnePager) for display-only tier info. `process` doesn't
// exist in the browser, so guard every read — the browser build simply gets
// `undefined` for Stripe price IDs, which the (optional) TierConfig fields
// already allow.
function getEnv(key: string): string | undefined {
  return typeof process !== 'undefined' && process.env ? process.env[key] : undefined;
}

export interface TierConfig {
  name: string;
  price: number;
  includedMinutes: number;
  overageRatePerMinute: number | null;
  dailyCapMinutes: number | null;
  hardStopAtLimit: boolean;
  stripePriceId?: string;
  stripeOveragePriceId?: string;
  infraCostPerMonth: number;
  grossMargin: string | null;
  trialDays?: number;
  stripeFeePerMonth?: number;
  targetCustomer?: string;
  description: string;
}

export const TIERS: Record<BillingTier, TierConfig> = {
  trial: {
    name: 'Trial',
    price: 0,
    includedMinutes: 500,
    overageRatePerMinute: null, // No overage on trial — hard stop only
    dailyCapMinutes: 50,
    hardStopAtLimit: true,
    trialDays: 30,
    infraCostPerMonth: 58, // 500 min x $0.115
    grossMargin: null, // Acquisition cost — not a revenue tier
    description: 'Full access, 30 days, no card required',
  },

  core: {
    name: 'Core',
    price: 799,
    includedMinutes: 1200,
    overageRatePerMinute: 0.25, // Cost $0.115 — $0.135 margin per overage min
    dailyCapMinutes: 100,
    hardStopAtLimit: false,
    // Legacy deployments configured STARTER/standard price envs before the
    // core/growth/scale rename — honor them so an old env never produces a
    // price ID that fails to map back to a minute pool.
    stripePriceId:
      getEnv('STRIPE_PRICE_CORE') ||
      getEnv('STRIPE_PRACTICE_STARTER_PRICE_ID') ||
      getEnv('STRIPE_PRACTICE_SUBSCRIPTION_PRICE_ID'),
    stripeOveragePriceId: getEnv('STRIPE_OVERAGE_PRICE_CORE'),
    infraCostPerMonth: 138, // 1,200 min x $0.115
    stripeFeePerMonth: 29, // 0.7% Stripe Billing + 2.9% card
    grossMargin: '79%',
    targetCustomer: 'Solo dentist, 1 location',
    description: '1,200 minutes/month. Best for practices with 20–40 outstanding claims.',
  },

  growth: {
    name: 'Growth',
    price: 1999,
    includedMinutes: 2800,
    overageRatePerMinute: 0.25, // Cost $0.115 — $0.135 margin per overage min
    dailyCapMinutes: 300,
    hardStopAtLimit: false,
    stripePriceId:
      getEnv('STRIPE_PRICE_GROWTH') || getEnv('STRIPE_PRACTICE_PROFESSIONAL_PRICE_ID'),
    stripeOveragePriceId: getEnv('STRIPE_OVERAGE_PRICE_GROWTH'),
    infraCostPerMonth: 322, // 2,800 min x $0.115
    stripeFeePerMonth: 72,
    grossMargin: '80%',
    targetCustomer: '2–3 dentist practice',
    description: '2,800 minutes/month. Best for practices with 50–100 outstanding claims.',
  },

  scale: {
    name: 'Scale',
    price: 2499,
    includedMinutes: 4000,
    overageRatePerMinute: 0.20, // Slight discount for top tier. Still profitable.
    dailyCapMinutes: null, // No daily cap on Scale
    hardStopAtLimit: false,
    stripePriceId:
      getEnv('STRIPE_PRICE_SCALE') || getEnv('STRIPE_PRACTICE_ENTERPRISE_PRICE_ID'),
    stripeOveragePriceId: getEnv('STRIPE_OVERAGE_PRICE_SCALE'),
    infraCostPerMonth: 460, // 4,000 min x $0.115
    stripeFeePerMonth: 90,
    grossMargin: '78%',
    targetCustomer: 'Group practice, DSO',
    description: '4,000 minutes/month. Best for multi-location or high-volume practices.',
  },
};

/** Trial expiry for a practice created now — every new signup must get one or the trial never ends. */
export function trialEndDate(from = new Date()): Date {
  return new Date(from.getTime() + (TIERS.trial.trialDays ?? 30) * 24 * 60 * 60 * 1000);
}

/** Resolve which paid tier a Stripe price ID belongs to, for syncing `practice.billingTier` from a webhook. */
export function billingTierForStripePrice(priceId: string | null | undefined): BillingTier | null {
  if (!priceId) return null;
  for (const [tier, config] of Object.entries(TIERS) as [BillingTier, TierConfig][]) {
    if (config.stripePriceId && config.stripePriceId === priceId) return tier;
  }
  return null;
}

// Warning thresholds — both fire, whichever comes first.
export const WARNINGS = {
  usagePercentThreshold: 0.80, // Warn at 80% of monthly minutes
  daysBeforeResetThreshold: 3, // Warn 3 days before billing period resets
};

// Call protection rules.
export const CALL_TIMEOUTS = {
  absoluteMaxMinutes: 45, // No call ever exceeds 45 min — hard ceiling
  dailySpendAlertPct: 0.30, // Alert founder if practice burns 30% of monthly in 1 day
};

// Carrier-specific timeout overrides (loaded from carrier JSON; these are fallback defaults).
export const CARRIER_TIMEOUTS: Record<string, number> = {
  'rbc-insurance': 45, // RBC avg 38 min hold — give full ceiling
  'green-shield': 30, // Green Shield avg 24 min
  'sun-life': 30,
  'canada-life': 30,
  manulife: 30,
  'telus-adjudicare': 30,
  default: 30,
};

// Per-practice COGS circuit breaker. Delivery cost is metered minutes ×
// UNIT_ECONOMICS.costPerMinute; crossing these fractions of the subscription
// price throttles, then pauses, so losing money on a practice is structurally
// impossible rather than statistically unlikely. Paid tiers only — trial has
// its own hard stop.
export const COGS_BREAKER = {
  throttleAtPctOfPrice: 0.40, // dispatch only HIGH/URGENT priority claims
  pauseAtPctOfPrice: 0.60, // pause all calls and alert
};

// Soft stop behavior on limit reached.
export const OVERAGE = {
  pauseOnSoftStop: true,
  resumeRequiresPracticeConfirmation: true,
  confirmationExpiryHours: 24, // Auto-decline overage if not confirmed in 24h
};

// Margin summary (for founder reference — not used in application logic).
export const UNIT_ECONOMICS = {
  costPerMinute: 0.115,
  breakdown: {
    vapi: 0.05,
    gpt5Mini: 0.02,
    deepgramNova3: 0.01,
    taraVoice: 0.02,
    twilio: 0.015,
    hosting: 0.01,
  },
  overageMinMargin: 0.085, // $0.20 overage (Scale) - $0.115 cost
  overageMaxMargin: 0.135, // $0.25 overage (Core/Growth) - $0.115 cost
};
