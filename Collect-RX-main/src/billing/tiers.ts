/**
 * CollectRx Billing — Tier Definitions
 *
 * Real cost per minute delivered: ~$0.135 (see UNIT_ECONOMICS below for the
 * sourced breakdown — Claude Haiku/Sonnet + 11Labs voice, not GPT-5 Mini/Tara).
 *
 * Pricing targets ~78%+ gross margin on paid tiers at realistic usage.
 * Overage priced at $0.25/min (Core/Growth) and $0.20/min (Scale) — profitable above cost.
 *
 * Single source of truth for tier limits and pricing. Never hardcode these
 * values anywhere else — read from TIERS / WARNINGS / CALL_TIMEOUTS / OVERAGE.
 */

import type { BillingTier, CarrierId } from '@prisma/client';

// This module is imported by client bundles (LandingPage, ProductOnePager, SubscriptionUsageCard,
// pricingContent) as well as server code. `process` only exists under Node — Vite's production
// build shims `process.env` to `{}` for the browser, but the dev server does not, so guard it here.
const env: Record<string, string | undefined> =
  typeof process !== 'undefined' && process.env ? process.env : {};

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
    infraCostPerMonth: 68, // 500 min x $0.135
    grossMargin: null, // Acquisition cost — not a revenue tier
    description: 'Full access, 30 days, no card required',
  },

  core: {
    name: 'Core',
    price: 799,
    includedMinutes: 1200,
    overageRatePerMinute: 0.25, // Cost $0.135 — $0.115 margin per overage min
    dailyCapMinutes: 100,
    hardStopAtLimit: false,
    // Legacy deployments configured STARTER/standard price envs before the
    // core/growth/scale rename — honor them so an old env never produces a
    // price ID that fails to map back to a minute pool.
    stripePriceId:
      env.STRIPE_PRICE_CORE ||
      env.STRIPE_PRACTICE_STARTER_PRICE_ID ||
      env.STRIPE_PRACTICE_SUBSCRIPTION_PRICE_ID,
    stripeOveragePriceId: env.STRIPE_OVERAGE_PRICE_CORE,
    infraCostPerMonth: 162, // 1,200 min x $0.135
    stripeFeePerMonth: 29, // 0.7% Stripe Billing + 2.9% card
    grossMargin: '80%',
    targetCustomer: 'Solo dentist, 1 location',
    description: '1,200 minutes/month. Best for practices with 20–40 outstanding claims.',
  },

  growth: {
    name: 'Growth',
    price: 1999,
    includedMinutes: 2800,
    overageRatePerMinute: 0.25, // Cost $0.135 — $0.115 margin per overage min
    dailyCapMinutes: 300,
    hardStopAtLimit: false,
    stripePriceId:
      env.STRIPE_PRICE_GROWTH || env.STRIPE_PRACTICE_PROFESSIONAL_PRICE_ID,
    stripeOveragePriceId: env.STRIPE_OVERAGE_PRICE_GROWTH,
    infraCostPerMonth: 378, // 2,800 min x $0.135
    stripeFeePerMonth: 72,
    grossMargin: '81%',
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
      env.STRIPE_PRICE_SCALE || env.STRIPE_PRACTICE_ENTERPRISE_PRICE_ID,
    stripeOveragePriceId: env.STRIPE_OVERAGE_PRICE_SCALE,
    infraCostPerMonth: 540, // 4,000 min x $0.135
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

// Fleet-wide ceiling on simultaneous calls to a single carrier, across every
// practice. Without this, several practices' queues can all dial the same
// carrier at once — a burst pattern carrier IVR security treats as scraping
// or a DDoS attempt, not organic call volume. Layered on top of the global
// vapiSlotBudget() in queueEngine.ts, which caps total concurrency but not
// per-carrier concentration.
export const CARRIER_CONCURRENCY_LIMITS: Record<CarrierId, number> = {
  sun_life: 5,
  canada_life: 5,
  manulife: 5,
  green_shield: 5,
  rbc: 5,
  telus_adjudicare: 5,
};

export const DEFAULT_CARRIER_CONCURRENCY_LIMIT = 5;

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

// Margin summary — feeds COGS_BREAKER (usagePeriodService.ts evaluateCogsBreaker),
// so this is a conservative ceiling for margin protection, not a per-call bill.
//
// Sourced from the Vapi dashboard's per-assistant cost breakdown (captured
// 2026-07-23), replacing a stale "GPT-5 Mini + Tara" breakdown that actually
// described the Sarah test-simulator persona, not the production squad. Real
// squad: Deepgram Nova 2/3 (STT) throughout; Claude Haiku 4.5 on Hold_Sentinel
// (~$0.09/min all Vapi-side, incl. Vapi's own platform fee); Claude Sonnet 4.5
// + 11Labs voice on IVR_Navigator/Claims_Agent/Escalation_Closer/
// Resolution_Closer (~$0.11-0.13/min Vapi-side — Claims_Agent highest, since
// it carries most of a call's talk time). Twilio telephony and CollectRx
// hosting are separate line items Vapi's own dashboard doesn't include.
//
// Nothing in CollectRx today tracks which agent handled which portion of a
// given call's duration, so this stays a blended estimate — not a per-call
// reconciliation — until that instrumentation exists.
export const UNIT_ECONOMICS = {
  costPerMinute: 0.135,
  breakdown: {
    vapiHoldSentinelHaiku: 0.09, // interim hold-wait agent (Claude Haiku 4.5)
    vapiTalkingSonnet: 0.13,     // Claims_Agent / IVR_Navigator / closers (Claude Sonnet 4.5 + 11Labs)
    twilio: 0.015,
    hosting: 0.01,
  },
  overageMinMargin: 0.065, // $0.20 overage (Scale) - $0.135 cost
  overageMaxMargin: 0.115, // $0.25 overage (Core/Growth) - $0.135 cost
};
