import { describe, expect, it } from 'vitest';
import { evaluateCogsBreaker } from '../src/server/plans/usagePeriodService.js';
import { COGS_BREAKER, TIERS, UNIT_ECONOMICS } from '../src/billing/tiers.js';

function minutesAtPctOfPrice(tierPrice: number, pct: number): number {
  return Math.ceil((tierPrice * pct) / UNIT_ECONOMICS.costPerMinute);
}

describe('evaluateCogsBreaker', () => {
  it('never trips on free tiers — trial has its own hard stop', () => {
    expect(evaluateCogsBreaker(TIERS.trial, 100_000)).toBe('ok');
  });

  it('is ok while delivery cost is below the throttle threshold', () => {
    const tier = TIERS.core;
    const minutes = minutesAtPctOfPrice(tier.price, COGS_BREAKER.throttleAtPctOfPrice) - 10;
    expect(evaluateCogsBreaker(tier, minutes)).toBe('ok');
  });

  it('throttles between the throttle and pause thresholds', () => {
    const tier = TIERS.core;
    const minutes = minutesAtPctOfPrice(tier.price, COGS_BREAKER.throttleAtPctOfPrice) + 1;
    expect(evaluateCogsBreaker(tier, minutes)).toBe('throttle');
  });

  it('pauses at the pause threshold', () => {
    const tier = TIERS.core;
    const minutes = minutesAtPctOfPrice(tier.price, COGS_BREAKER.pauseAtPctOfPrice) + 1;
    expect(evaluateCogsBreaker(tier, minutes)).toBe('pause');
  });

  it('throttles the thin-margin Scale tier before included minutes run out', () => {
    const tier = TIERS.scale;
    const throttleMinutes = minutesAtPctOfPrice(tier.price, COGS_BREAKER.throttleAtPctOfPrice);
    expect(throttleMinutes).toBeLessThan(tier.includedMinutes);
    expect(evaluateCogsBreaker(tier, throttleMinutes + 1)).toBe('throttle');
  });
});
