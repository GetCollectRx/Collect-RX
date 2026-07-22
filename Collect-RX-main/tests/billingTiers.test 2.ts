import { afterEach, describe, expect, it, vi } from 'vitest';

async function freshTiers() {
  vi.resetModules();
  vi.stubEnv('STRIPE_PRICE_CORE', 'price_core_test');
  vi.stubEnv('STRIPE_PRICE_GROWTH', 'price_growth_test');
  vi.stubEnv('STRIPE_PRICE_SCALE', 'price_scale_test');
  return import('../src/billing/tiers.js');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('billingTierForStripePrice', () => {
  it('resolves a known Stripe price to its billing tier', async () => {
    const { billingTierForStripePrice } = await freshTiers();
    expect(billingTierForStripePrice('price_core_test')).toBe('core');
    expect(billingTierForStripePrice('price_growth_test')).toBe('growth');
    expect(billingTierForStripePrice('price_scale_test')).toBe('scale');
  });

  it('returns null for an unrecognized price ID', async () => {
    const { billingTierForStripePrice } = await freshTiers();
    expect(billingTierForStripePrice('price_unknown')).toBeNull();
  });

  it('returns null for a missing price ID', async () => {
    const { billingTierForStripePrice } = await freshTiers();
    expect(billingTierForStripePrice(null)).toBeNull();
    expect(billingTierForStripePrice(undefined)).toBeNull();
  });
});
