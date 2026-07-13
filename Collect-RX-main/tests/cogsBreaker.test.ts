import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { evaluateCallGate, evaluateCogsBreaker } from '../src/server/plans/usagePeriodService.js';
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

describe('evaluateCallGate — confirmed overage', () => {
  function gatePrisma(opts: { overageConfirmed: boolean; minutesConsumed: number }) {
    const pauseSpy = vi.fn(async () => ({ count: 1 }));
    const prisma = {
      practice: {
        findUnique: vi.fn(async () => ({
          id: 'practice-1',
          billingTier: 'core',
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

  it('allows dispatch once the practice confirms overage charges', async () => {
    const exhausted = TIERS.core.includedMinutes + 50;
    const { prisma, pauseSpy } = gatePrisma({ overageConfirmed: true, minutesConsumed: exhausted });
    const gate = await evaluateCallGate(prisma, 'practice-1');
    expect(gate.allowed).toBe(true);
    expect(gate.reason).toBe('OK');
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
});
