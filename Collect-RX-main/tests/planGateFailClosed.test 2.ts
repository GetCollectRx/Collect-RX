/**
 * Fail-closed licensing gate: under SUBSCRIPTION_ENFORCE=1 a paid tier must
 * never dial without a live Stripe subscription and correctly-mapped price
 * envs. Trial limits and daily caps hold regardless of enforcement mode.
 *
 * TIERS captures STRIPE_PRICE_* at module load, so every test sets env first
 * and re-imports via vi.resetModules().
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const ORIGINAL_ENV = { ...process.env };

const PRICE_ENV_KEYS = [
  'SUBSCRIPTION_ENFORCE',
  'BILLING_SKIP_PRACTICE_IDS',
  'STRIPE_PRICE_CORE',
  'STRIPE_PRICE_GROWTH',
  'STRIPE_PRICE_SCALE',
  'STRIPE_PRACTICE_STARTER_PRICE_ID',
  'STRIPE_PRACTICE_PROFESSIONAL_PRICE_ID',
  'STRIPE_PRACTICE_ENTERPRISE_PRICE_ID',
  'STRIPE_PRACTICE_SUBSCRIPTION_PRICE_ID',
];

beforeEach(() => {
  for (const key of PRICE_ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

async function loadGate() {
  vi.resetModules();
  return import('../src/server/plans/usagePeriodService.js');
}

type PracticeShape = {
  id: string;
  billingTier: string;
  subscriptionStatus: string | null;
  subscriptionPriceId?: string | null;
  trialEndsAt: Date | null;
  callsPaused: boolean;
  callsPausedReason: string | null;
  callsPausedAt: Date | null;
  overageConfirmed: boolean;
  overageConfirmedAt: Date | null;
  subscriptionCurrentPeriodEnd: Date | null;
  billingPeriodStart: Date | null;
};

function corePractice(overrides: Partial<PracticeShape> = {}): PracticeShape {
  return {
    id: 'practice-1',
    billingTier: 'core',
    subscriptionStatus: 'active',
    subscriptionPriceId: null,
    trialEndsAt: null,
    callsPaused: false,
    callsPausedReason: null,
    callsPausedAt: null,
    overageConfirmed: false,
    overageConfirmedAt: null,
    subscriptionCurrentPeriodEnd: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    billingPeriodStart: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

function mockPrisma(practice: PracticeShape, opts: { minutesConsumed?: number; todayMinutes?: number } = {}) {
  const pauseSpy = vi.fn(async () => ({ count: 1 }));
  const prisma = {
    practice: {
      findUnique: vi.fn(async () => practice),
      updateMany: pauseSpy,
    },
    usagePeriod: {
      findFirst: vi.fn(async () => ({
        id: 'usage-1',
        practiceId: practice.id,
        periodStart: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
        periodEnd: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        minutesConsumed: opts.minutesConsumed ?? 0,
        callsCompleted: 1,
        warning80Sent: false,
      })),
    },
    callAttempt: {
      aggregate: vi.fn(async () => ({ _sum: { minutesBilled: opts.todayMinutes ?? 0 } })),
    },
  } as unknown as PrismaClient;
  return { prisma, pauseSpy };
}

describe('evaluateCallGate — SUBSCRIPTION_ENFORCE fail-closed', () => {
  it('blocks a paid tier when the tier has no Stripe price env configured', async () => {
    process.env.SUBSCRIPTION_ENFORCE = '1';
    const { evaluateCallGate } = await loadGate();
    const { prisma } = mockPrisma(corePractice());
    const gate = await evaluateCallGate(prisma, 'practice-1');
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('BILLING_MISCONFIGURED');
  });

  it('blocks a paid tier with no active subscription', async () => {
    process.env.SUBSCRIPTION_ENFORCE = '1';
    process.env.STRIPE_PRICE_CORE = 'price_core';
    const { evaluateCallGate } = await loadGate();
    const { prisma } = mockPrisma(corePractice({ subscriptionStatus: null }));
    const gate = await evaluateCallGate(prisma, 'practice-1');
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('SUBSCRIPTION_CANCELED');
  });

  it('blocks when the stored subscription price maps to a different tier (Core must never get Growth minutes)', async () => {
    process.env.SUBSCRIPTION_ENFORCE = '1';
    process.env.STRIPE_PRICE_CORE = 'price_core';
    process.env.STRIPE_PRICE_GROWTH = 'price_growth';
    const { evaluateCallGate } = await loadGate();
    const { prisma } = mockPrisma(
      corePractice({ billingTier: 'growth', subscriptionPriceId: 'price_core' }),
    );
    const gate = await evaluateCallGate(prisma, 'practice-1');
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('BILLING_MISCONFIGURED');
  });

  it('blocks when the stored subscription price maps to no tier at all', async () => {
    process.env.SUBSCRIPTION_ENFORCE = '1';
    process.env.STRIPE_PRICE_CORE = 'price_core';
    const { evaluateCallGate } = await loadGate();
    const { prisma } = mockPrisma(corePractice({ subscriptionPriceId: 'price_unknown' }));
    const gate = await evaluateCallGate(prisma, 'practice-1');
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('BILLING_MISCONFIGURED');
  });

  it('allows a correctly-configured active paid practice', async () => {
    process.env.SUBSCRIPTION_ENFORCE = '1';
    process.env.STRIPE_PRICE_CORE = 'price_core';
    const { evaluateCallGate } = await loadGate();
    const { prisma } = mockPrisma(corePractice({ subscriptionPriceId: 'price_core' }));
    const gate = await evaluateCallGate(prisma, 'practice-1');
    expect(gate.allowed).toBe(true);
    expect(gate.reason).toBe('OK');
  });

  it('honors BILLING_SKIP_PRACTICE_IDS for pilot practices without Stripe', async () => {
    process.env.SUBSCRIPTION_ENFORCE = '1';
    process.env.BILLING_SKIP_PRACTICE_IDS = 'practice-1';
    const { evaluateCallGate } = await loadGate();
    const { prisma } = mockPrisma(corePractice({ subscriptionStatus: null }));
    const gate = await evaluateCallGate(prisma, 'practice-1');
    expect(gate.allowed).toBe(true);
  });

  it('does not add checks when enforcement is off', async () => {
    const { evaluateCallGate } = await loadGate();
    const { prisma } = mockPrisma(corePractice({ subscriptionStatus: null }));
    const gate = await evaluateCallGate(prisma, 'practice-1');
    expect(gate.allowed).toBe(true);
  });

  it('legacy STARTER price env maps into the core tier so old deployments still unlock the right pool', async () => {
    process.env.STRIPE_PRACTICE_STARTER_PRICE_ID = 'price_legacy_starter';
    vi.resetModules();
    const { billingTierForStripePrice } = await import('../src/billing/tiers.js');
    expect(billingTierForStripePrice('price_legacy_starter')).toBe('core');
  });
});

describe('evaluateCallGate — tier limits (canonical tiers.ts numbers)', () => {
  it('hard-stops a trial at 500 monthly minutes', async () => {
    const { evaluateCallGate } = await loadGate();
    const { prisma } = mockPrisma(
      corePractice({
        billingTier: 'trial',
        subscriptionStatus: null,
        trialEndsAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      }),
      { minutesConsumed: 500 },
    );
    const gate = await evaluateCallGate(prisma, 'practice-1');
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('TRIAL_LIMIT_REACHED');
  });

  it('hard-stops a trial at the 50-minute daily cap', async () => {
    const { evaluateCallGate } = await loadGate();
    const { prisma } = mockPrisma(
      corePractice({
        billingTier: 'trial',
        subscriptionStatus: null,
        trialEndsAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      }),
      { minutesConsumed: 100, todayMinutes: 50 },
    );
    const gate = await evaluateCallGate(prisma, 'practice-1');
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('DAILY_CAP_REACHED');
  });

  it('blocks an expired trial even with minutes left', async () => {
    const { evaluateCallGate } = await loadGate();
    const { prisma } = mockPrisma(
      corePractice({
        billingTier: 'trial',
        subscriptionStatus: null,
        trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      }),
      { minutesConsumed: 10 },
    );
    const gate = await evaluateCallGate(prisma, 'practice-1');
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('TRIAL_LIMIT_REACHED');
  });

  it('soft-stops core at 1200 minutes and pauses until overage is confirmed', async () => {
    const { evaluateCallGate } = await loadGate();
    const { prisma, pauseSpy } = mockPrisma(corePractice(), { minutesConsumed: 1200 });
    const gate = await evaluateCallGate(prisma, 'practice-1');
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('OVERAGE_PENDING');
    expect(pauseSpy).toHaveBeenCalled();
  });

  it('enforces the core 100-minute daily cap', async () => {
    const { evaluateCallGate } = await loadGate();
    const { prisma } = mockPrisma(corePractice(), { minutesConsumed: 200, todayMinutes: 100 });
    const gate = await evaluateCallGate(prisma, 'practice-1');
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('DAILY_CAP_REACHED');
  });

  it('scale has no daily cap', async () => {
    const { evaluateCallGate } = await loadGate();
    const { prisma } = mockPrisma(
      corePractice({ billingTier: 'scale' }),
      { minutesConsumed: 500, todayMinutes: 400 },
    );
    const gate = await evaluateCallGate(prisma, 'practice-1');
    expect(gate.allowed).toBe(true);
  });

  it('plan pause (callsPaused) blocks dispatch regardless of minutes', async () => {
    const { evaluateCallGate } = await loadGate();
    const { prisma } = mockPrisma(
      corePractice({ callsPaused: true, callsPausedReason: 'overage_pending', callsPausedAt: new Date() }),
      { minutesConsumed: 10 },
    );
    const gate = await evaluateCallGate(prisma, 'practice-1');
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('OVERAGE_PENDING');
  });
});

describe('confirmOverage — 24h expiry', () => {
  function overagePrisma(pausedAt: Date) {
    const updateSpy = vi.fn(async () => ({}));
    const prisma = {
      practice: {
        findUnique: vi.fn(async () =>
          corePractice({ callsPaused: true, callsPausedReason: 'overage_pending', callsPausedAt: pausedAt }),
        ),
        update: updateSpy,
      },
    } as unknown as PrismaClient;
    return { prisma, updateSpy };
  }

  it('resumes calling when confirmed within the window', async () => {
    const { confirmOverage } = await loadGate();
    const { prisma, updateSpy } = overagePrisma(new Date(Date.now() - 60 * 60 * 1000));
    const result = await confirmOverage(prisma, 'practice-1');
    expect(result.status).toBe('resumed');
    expect(updateSpy).toHaveBeenCalled();
  });

  it('auto-declines a confirmation after 24 hours — calls stay paused', async () => {
    const { confirmOverage } = await loadGate();
    const { prisma, updateSpy } = overagePrisma(new Date(Date.now() - 25 * 60 * 60 * 1000));
    const result = await confirmOverage(prisma, 'practice-1');
    expect(result.status).toBe('expired');
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
