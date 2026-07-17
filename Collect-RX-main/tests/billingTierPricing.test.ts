import { describe, expect, it } from 'vitest';
import { TIERS } from '../src/billing/tiers';
import { paidTierCards } from '../src/website/pricingContent';

describe('billing tier shelf prices', () => {
  it('exposes updated Core / Growth / Scale shelf prices', () => {
    expect(TIERS.core.price).toBe(799);
    expect(TIERS.growth.price).toBe(1999);
    expect(TIERS.scale.price).toBe(2499);
  });

  it('includes revised minute buckets', () => {
    expect(TIERS.core.includedMinutes).toBe(1200);
    expect(TIERS.growth.includedMinutes).toBe(2800);
    expect(TIERS.scale.includedMinutes).toBe(4000);
  });
});

describe('paidTierCards', () => {
  it('builds three marketing cards from tier config', () => {
    const cards = paidTierCards();
    expect(cards).toHaveLength(3);
    expect(cards.map((c) => c.price)).toEqual([799, 1999, 2499]);
    expect(cards.find((c) => c.highlight)?.id).toBe('growth');
  });
});
