/**
 * Sellable catalog = core/growth/scale from tiers.ts, keyed by Stripe price
 * envs (with legacy STARTER/PROFESSIONAL/ENTERPRISE aliases). Plus the call
 * duration ceiling and trial defaults every new signup must get.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

const ENV_KEYS = [
  'STRIPE_PRICE_CORE',
  'STRIPE_PRICE_GROWTH',
  'STRIPE_PRICE_SCALE',
  'STRIPE_PRACTICE_STARTER_PRICE_ID',
  'STRIPE_PRACTICE_PROFESSIONAL_PRICE_ID',
  'STRIPE_PRACTICE_ENTERPRISE_PRICE_ID',
  'STRIPE_PRACTICE_SUBSCRIPTION_PRICE_ID',
  'SUBSCRIPTION_DEFAULT_PLAN_ID',
  'SUBSCRIPTION_PLAN_CONFIG',
];

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

async function loadPlans() {
  return import('../src/server/stripe/subscriptionPlans.js');
}

describe('subscriptionPlanCatalog', () => {
  it('lists exactly the configured paid tiers with ids matching BillingTier values', async () => {
    process.env.STRIPE_PRICE_CORE = 'price_core';
    process.env.STRIPE_PRICE_GROWTH = 'price_growth';
    process.env.STRIPE_PRICE_SCALE = 'price_scale';
    const { subscriptionPlanCatalog } = await loadPlans();
    const catalog = subscriptionPlanCatalog();
    expect(catalog.map((p) => p.id)).toEqual(['core', 'growth', 'scale']);
    expect(catalog.map((p) => p.priceId)).toEqual(['price_core', 'price_growth', 'price_scale']);
  });

  it('never emits starter/professional/enterprise ids — legacy envs alias into tiers', async () => {
    process.env.STRIPE_PRACTICE_STARTER_PRICE_ID = 'price_old_starter';
    process.env.STRIPE_PRACTICE_PROFESSIONAL_PRICE_ID = 'price_old_pro';
    process.env.STRIPE_PRACTICE_ENTERPRISE_PRICE_ID = 'price_old_ent';
    const { subscriptionPlanCatalog } = await loadPlans();
    const catalog = subscriptionPlanCatalog();
    expect(catalog.map((p) => p.id)).toEqual(['core', 'growth', 'scale']);
    expect(catalog.find((p) => p.id === 'core')?.priceId).toBe('price_old_starter');
    expect(catalog.find((p) => p.id === 'growth')?.priceId).toBe('price_old_pro');
    expect(catalog.find((p) => p.id === 'scale')?.priceId).toBe('price_old_ent');
  });

  it('claim-count limits are retired — minutes are the meter', async () => {
    process.env.STRIPE_PRICE_CORE = 'price_core';
    const { subscriptionPlanCatalog } = await loadPlans();
    expect(subscriptionPlanCatalog().every((p) => p.monthlyClaimLimit === null)).toBe(true);
  });

  it('is empty when no Stripe prices are configured (fail closed, not a guessed plan)', async () => {
    const { subscriptionPlanCatalog, defaultSubscriptionPlan } = await loadPlans();
    expect(subscriptionPlanCatalog()).toEqual([]);
    expect(defaultSubscriptionPlan()).toBeNull();
  });

  it('defaults to core', async () => {
    process.env.STRIPE_PRICE_CORE = 'price_core';
    process.env.STRIPE_PRICE_GROWTH = 'price_growth';
    const { defaultSubscriptionPlan } = await loadPlans();
    expect(defaultSubscriptionPlan()?.id).toBe('core');
  });

  it('honors SUBSCRIPTION_DEFAULT_PLAN_ID when it names a real tier', async () => {
    process.env.STRIPE_PRICE_CORE = 'price_core';
    process.env.STRIPE_PRICE_GROWTH = 'price_growth';
    process.env.SUBSCRIPTION_DEFAULT_PLAN_ID = 'growth';
    const { defaultSubscriptionPlan } = await loadPlans();
    expect(defaultSubscriptionPlan()?.id).toBe('growth');
  });

  it('legacy single-price env maps to core so an old deployment still sells the right pool', async () => {
    process.env.STRIPE_PRACTICE_SUBSCRIPTION_PRICE_ID = 'price_legacy';
    const { subscriptionPlanCatalog } = await loadPlans();
    const catalog = subscriptionPlanCatalog();
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({ id: 'core', priceId: 'price_legacy' });
  });
});

describe('maxCallDurationSeconds — 45-minute absolute ceiling', () => {
  it('caps every carrier at or below 45 minutes', async () => {
    const { maxCallDurationSeconds } = await import('../src/vapi/client.js');
    const { CARRIER_TIMEOUTS, CALL_TIMEOUTS } = await import('../src/billing/tiers.js');
    for (const carrierId of Object.keys(CARRIER_TIMEOUTS)) {
      expect(maxCallDurationSeconds(carrierId)).toBeLessThanOrEqual(CALL_TIMEOUTS.absoluteMaxMinutes * 60);
    }
  });

  it('RBC gets the full 45-minute ceiling, standard carriers 30 minutes, unknown carriers the default', async () => {
    const { maxCallDurationSeconds } = await import('../src/vapi/client.js');
    expect(maxCallDurationSeconds('rbc-insurance')).toBe(45 * 60);
    expect(maxCallDurationSeconds('sun-life')).toBe(30 * 60);
    expect(maxCallDurationSeconds('never-heard-of-it')).toBe(30 * 60);
  });
});

describe('trialEndDate — new signup defaults', () => {
  it('is trialDays (30) after the given date', async () => {
    const { trialEndDate, TIERS } = await import('../src/billing/tiers.js');
    const from = new Date('2026-07-01T00:00:00Z');
    const expected = new Date(from.getTime() + (TIERS.trial.trialDays ?? 30) * 24 * 60 * 60 * 1000);
    expect(trialEndDate(from).toISOString()).toBe(expected.toISOString());
    expect(TIERS.trial.trialDays).toBe(30);
  });
});
