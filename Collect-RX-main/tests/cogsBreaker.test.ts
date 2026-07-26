import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { evaluateCallGate, evaluateCogsBreaker } from '../src/server/plans/usagePeriodService.js';
import { COGS_BREAKER, TIERS, UNIT_ECONOMICS, type TierConfig } from '../src/billing/tiers.js';

/**
 * Solves for the minutesConsumed at which delivery cost equals `pct` of
 * revenue-collected-so-far, in the overage zone (minutesConsumed > includedMinutes,
 * revenue = price + overageMinutes * overageRate). Throws if `pct` is
 * structurally unreachable for this tier — which happens whenever the
 * overage rate's margin over cost keeps the cost/revenue ratio permanently
 * below `pct` no matter how many overage minutes accumulate (asymptote =
 * costPerMinute / overageRatePerMinute). That's not a test bug — it's the
 * real, tier-dependent shape of evaluateCogsBreaker's new revenue-aware math.
 */
function minutesForPctOfRevenueInOverage(tier: TierConfig, pct: number): number {
  const overageRate = tier.overageRatePerMinute ?? 0;
  const numerator = pct * (tier.price - overageRate * tier.includedMinutes);
  const denominator = UNIT_ECONOMICS.costPerMinute - pct * overageRate;
  if (denominator <= 0) {
    throw new Error(
      `pct=${pct} is unreachable for ${tier.name}'s overage margin — cost/revenue ratio asymptotically caps at ${(UNIT_ECONOMICS.costPerMinute / overageRate * 100).toFixed(1)}%`,
    );
  }
  return Math.ceil(numerator / denominator);
}

describe('evaluateCogsBreaker', () => {
  it('never trips on free tiers — trial has its own hard stop', () => {
    expect(evaluateCogsBreaker(TIERS.trial, 100_000)).toBe('ok');
  });

  it('is always ok while strictly within included minutes — every tier is priced so 100% utilization only reaches ~20% of price, well under the 40% throttle floor', () => {
    for (const tier of [TIERS.core, TIERS.growth, TIERS.scale]) {
      expect(evaluateCogsBreaker(tier, tier.includedMinutes)).toBe('ok');
    }
  });

  // Scale is used for the threshold-boundary tests below because its overage
  // margin (rate 0.20 vs cost 0.135) keeps the cost/revenue asymptote at 67.5%
  // — above both the 40% throttle and 60% pause thresholds, so both are
  // reachable at a finite (if large) minute count. Core's margin (rate 0.25
  // vs cost 0.135) asymptotes at 54%, meaning pause is never reachable for
  // Core no matter how much overage a practice runs — see the dedicated test
  // below confirming that's expected, not a gap.
  it('throttles between the throttle and pause thresholds, in the overage zone', () => {
    const tier = TIERS.scale;
    const throttleMinutes = minutesForPctOfRevenueInOverage(tier, COGS_BREAKER.throttleAtPctOfPrice);
    expect(evaluateCogsBreaker(tier, throttleMinutes + 1)).toBe('throttle');
  });

  it('pauses at the pause threshold, in the overage zone', () => {
    const tier = TIERS.scale;
    const pauseMinutes = minutesForPctOfRevenueInOverage(tier, COGS_BREAKER.pauseAtPctOfPrice);
    expect(evaluateCogsBreaker(tier, pauseMinutes + 1)).toBe('pause');
  });

  it('Core tier can throttle in extreme overage, but structurally can never reach pause — its overage margin (0.25 rate vs 0.135 cost) caps the cost/revenue ratio at 54%, below the 60% pause threshold, no matter how many overage minutes accumulate', () => {
    const tier = TIERS.core;
    const throttleMinutes = minutesForPctOfRevenueInOverage(tier, COGS_BREAKER.throttleAtPctOfPrice);
    expect(evaluateCogsBreaker(tier, throttleMinutes + 1)).toBe('throttle');
    expect(() => minutesForPctOfRevenueInOverage(tier, COGS_BREAKER.pauseAtPctOfPrice)).toThrow();
    // Even at an absurd number of overage minutes, still never 'pause'.
    expect(evaluateCogsBreaker(tier, 10_000_000)).not.toBe('pause');
  });
});

describe('evaluateCallGate — confirmed overage is now subject to the COGS breaker', () => {
  function gatePrisma(opts: { billingTier?: keyof typeof TIERS; overageConfirmed: boolean; minutesConsumed: number }) {
    const pauseSpy = vi.fn(async () => ({ count: 1 }));
    const prisma = {
      practice: {
        findUnique: vi.fn(async () => ({
          id: 'practice-1',
          billingTier: opts.billingTier ?? 'core',
          subscriptionStatus: 'active',
          trialEndsAt: null,
          callsPaused: false,
          callsPausedReason: null,
          callsPausedAt: null,
          overageConfirmed: opts.overageConfirmed,
          overageConfirmedAt: opts.overageConfirmed ? new Date() : null,
          subscriptionCurrentPeriodEnd: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
          billingPeriodStart: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
        })),
        updateMany: pauseSpy,
      },
      usagePeriod: {
        findFirst: vi.fn(async () => ({
          id: 'usage-1',
          practiceId: 'practice-1',
          periodStart: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
          periodEnd: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
          minutesConsumed: opts.minutesConsumed,
          callsCompleted: 10,
          warning80Sent: true,
        })),
      },
      callAttempt: {
        aggregate: vi.fn(async () => ({ _sum: { minutesBilled: 0 } })),
      },
    } as unknown as PrismaClient;
    return { prisma, pauseSpy };
  }

  it('allows dispatch once the practice confirms overage charges, at ordinary overage usage', async () => {
    const exhausted = TIERS.core.includedMinutes + 50;
    const { prisma, pauseSpy } = gatePrisma({ overageConfirmed: true, minutesConsumed: exhausted });
    const gate = await evaluateCallGate(prisma, 'practice-1');
    expect(gate.allowed).toBe(true);
    expect(gate.reason).toBe('OK');
    expect(gate.overageRatePerMinute).toBe(TIERS.core.overageRatePerMinute);
    expect(pauseSpy).not.toHaveBeenCalled();
  });

  it('still soft-stops when overage is not confirmed', async () => {
    const exhausted = TIERS.core.includedMinutes + 50;
    const { prisma, pauseSpy } = gatePrisma({ overageConfirmed: false, minutesConsumed: exhausted });
    const gate = await evaluateCallGate(prisma, 'practice-1');
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('OVERAGE_PENDING');
    expect(pauseSpy).toHaveBeenCalled();
  });

  it(
    'THE FIX: a confirmed-overage practice burning enough minutes to cross the throttle threshold now gets throttled — previously this was completely unchecked (any confirmed-overage minutes were unconditionally allowed, per the removed early return)',
    async () => {
      const throttleMinutes = minutesForPctOfRevenueInOverage(TIERS.scale, COGS_BREAKER.throttleAtPctOfPrice);
      const { prisma, pauseSpy } = gatePrisma({
        billingTier: 'scale',
        overageConfirmed: true,
        minutesConsumed: throttleMinutes + 1,
      });
      const gate = await evaluateCallGate(prisma, 'practice-1');
      expect(gate.allowed).toBe(true);
      expect(gate.essentialOnly).toBe(true);
      expect(gate.overageRatePerMinute).toBe(TIERS.scale.overageRatePerMinute);
      expect(pauseSpy).not.toHaveBeenCalled(); // throttle, not pause
    },
  );

  it(
    'THE FIX: a confirmed-overage practice burning enough minutes to cross the pause threshold now actually gets paused',
    async () => {
      const pauseMinutes = minutesForPctOfRevenueInOverage(TIERS.scale, COGS_BREAKER.pauseAtPctOfPrice);
      const { prisma, pauseSpy } = gatePrisma({
        billingTier: 'scale',
        overageConfirmed: true,
        minutesConsumed: pauseMinutes + 1,
      });
      const gate = await evaluateCallGate(prisma, 'practice-1');
      expect(gate.allowed).toBe(false);
      expect(gate.reason).toBe('COGS_BREAKER_PAUSED');
      expect(pauseSpy).toHaveBeenCalled();
    },
  );
});
