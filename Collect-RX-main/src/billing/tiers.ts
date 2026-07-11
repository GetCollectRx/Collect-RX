/**
 * CollectRx Billing — Tier Definitions
 *
 * Real cost per minute delivered: ~$0.115
 * (Vapi $0.05 + GPT-5 Mini $0.02 + Deepgram Nova 3 $0.01 + Tara TTS $0.02 + Twilio $0.015 + hosting $0.01)
 *
 * Pricing targets 50%+ gross margin on all paid tiers.
 * Overage priced at $0.25/min (Core/Growth) and $0.20/min (Scale) — profitable above cost.
 *
 * Single source of truth for tier limits and pricing. Never hardcode these
 * values anywhere else — read from TIERS / WARNINGS / CALL_TIMEOUTS / OVERAGE.
 */

import type { BillingTier } from '@prisma/client';

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
    price: 599,
    includedMinutes: 800,
    overageRatePerMinute: 0.25, // Cost $0.115 — $0.135 margin per overage min
    dailyCapMinutes: 100,
    hardStopAtLimit: false,
    stripePriceId: process.env.STRIPE_PRICE_CORE,
    stripeOveragePriceId: process.env.STRIPE_OVERAGE_PRICE_CORE,
    infraCostPerMonth: 92, // 800 min x $0.115
    stripeFeePerMonth: 17, // 0.7% Stripe Billing + 2.9% card
    grossMargin: '82%',
    targetCustomer: 'Solo dentist, 1 location',
    description: '800 minutes/month. Best for practices with 20-40 outstanding claims.',
  },

  growth: {
    name: 'Growth',
    price: 1299,
    includedMinutes: 2000,
    overageRatePerMinute: 0.25, // Cost $0.115 — $0.135 margin per overage min
    dailyCapMinutes: 300,
    hardStopAtLimit: false,
    stripePriceId: process.env.STRIPE_PRICE_GROWTH,
    stripeOveragePriceId: process.env.STRIPE_OVERAGE_PRICE_GROWTH,
    infraCostPerMonth: 230, // 2000 min x $0.115
    stripeFeePerMonth: 36,
    grossMargin: '80%',
    targetCustomer: '2-3 dentist practice',
    description: '2,000 minutes/month. Best for practices with 50-100 outstanding claims.',
  },

  scale: {
    name: 'Scale',
    price: 1499,
    includedMinutes: 7000,
    overageRatePerMinute: 0.20, // Slight discount for top tier. Still profitable.
    dailyCapMinutes: null, // No daily cap on Scale
    hardStopAtLimit: false,
    stripePriceId: process.env.STRIPE_PRICE_SCALE,
    stripeOveragePriceId: process.env.STRIPE_OVERAGE_PRICE_SCALE,
    infraCostPerMonth: 805, // 7000 min x $0.115
    stripeFeePerMonth: 42,
    grossMargin: '43%',
    targetCustomer: 'Group practice, DSO',
    description: '7,000 minutes/month. Best for multi-location or high-volume practices.',
  },
};

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
