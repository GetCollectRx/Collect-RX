import { describe, expect, it } from 'vitest';
import { TIERS } from '../src/billing/tiers';
import { paidTierCards } from '../src/website/pricingContent';
import { evaluateCogsBreaker } from '../src/server/plans/usagePeriodService';

describe('billing tier shelf prices', () => {
  it('exposes Hold Sentinel / Recovery / Growth / Scale shelf prices', () => {
    expect(TIERS.sentinel.price).toBe(399);
    expect(TIERS.core.price).toBe(799);
    expect(TIERS.core.name).toBe('Recovery');
    expect(TIERS.growth.price).toBe(1999);
    expect(TIERS.scale.price).toBe(2499);
  });

  it('includes revised minute buckets', () => {
    expect(TIERS.sentinel.includedMinutes).toBe(1000);
    expect(TIERS.core.includedMinutes).toBe(1200);
    expect(TIERS.growth.includedMinutes).toBe(2800);
    expect(TIERS.scale.includedMinutes).toBe(4000);
  });
});

describe('paidTierCards', () => {
  it('builds four marketing cards from tier config, Hold Sentinel first', () => {
    const cards = paidTierCards();
    expect(cards).toHaveLength(4);
    expect(cards.map((c) => c.price)).toEqual([399, 799, 1999, 2499]);
    expect(cards.find((c) => c.highlight)?.id).toBe('growth');
  });
});

describe('Hold Sentinel and the COGS breaker', () => {
  it('stays below the throttle line for its whole included-minute pool', () => {
    expect(evaluateCogsBreaker(TIERS.sentinel, TIERS.sentinel.includedMinutes)).toBe('ok');
  });
});
