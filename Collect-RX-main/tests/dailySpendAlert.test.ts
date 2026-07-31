/**
 * Daily spend alert: recordCallUsage alerts ops exactly when one day's usage
 * crosses CALL_TIMEOUTS.dailySpendAlertPct (30%) of the monthly allowance.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const dispatchOpsAlert = vi.fn(async () => ({ delivered: true }));
vi.mock('../src/server/observability/opsAlerts.js', () => ({
  dispatchOpsAlert: (...args: unknown[]) => dispatchOpsAlert(...(args as [])),
}));

import { recordCallUsage } from '../src/server/plans/usagePeriodService.js';
import { CALL_TIMEOUTS, TIERS } from '../src/billing/tiers.js';

function usagePrisma(opts: { durationSeconds: number; todayMinutesAfter: number }) {
  const practice = {
    id: 'practice-1',
    billingTier: 'core',
    subscriptionStatus: 'active',
    trialEndsAt: null,
    callsPaused: false,
    callsPausedReason: null,
    callsPausedAt: null,
    overageConfirmed: false,
    overageConfirmedAt: null,
    subscriptionCurrentPeriodEnd: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    billingPeriodStart: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
  };
  const usage = {
    id: 'usage-1',
    practiceId: 'practice-1',
    periodStart: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
    periodEnd: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    minutesConsumed: 400,
    callsCompleted: 5,
    warning80Sent: true,
  };
  const prisma = {
    callAttempt: {
      findUnique: vi.fn(async () => ({
        id: 'attempt-1',
        durationSeconds: opts.durationSeconds,
        minutesBilled: null,
      })),
      update: vi.fn(async () => ({})),
      aggregate: vi.fn(async () => ({ _sum: { minutesBilled: opts.todayMinutesAfter } })),
    },
    practice: {
      findUnique: vi.fn(async () => practice),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    usagePeriod: {
      findFirst: vi.fn(async () => usage),
      findUnique: vi.fn(async () => ({ ...usage, minutesConsumed: 430 })),
      update: vi.fn(async () => ({})),
    },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  } as unknown as PrismaClient;
  return prisma;
}

describe('recordCallUsage — daily spend alert', () => {
  beforeEach(() => {
    dispatchOpsAlert.mockClear();
  });

  it('fires when the day crosses 30% of the monthly allowance', async () => {
    const threshold = TIERS.core.includedMinutes * CALL_TIMEOUTS.dailySpendAlertPct; // 360
    const prisma = usagePrisma({ durationSeconds: 30 * 60, todayMinutesAfter: threshold + 10 });
    const result = await recordCallUsage(prisma, { practiceId: 'practice-1', vapiCallId: 'call-1' });
    expect(result.recorded).toBe(true);
    expect(result.minutesBilled).toBe(30);
    expect(dispatchOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({ alertId: 'daily_spend', source: 'practice-1' }),
    );
  });

  it('does not fire below the threshold', async () => {
    const prisma = usagePrisma({ durationSeconds: 30 * 60, todayMinutesAfter: 200 });
    await recordCallUsage(prisma, { practiceId: 'practice-1', vapiCallId: 'call-1' });
    expect(dispatchOpsAlert).not.toHaveBeenCalled();
  });

  it('does not re-fire once already past the threshold before this call', async () => {
    const threshold = TIERS.core.includedMinutes * CALL_TIMEOUTS.dailySpendAlertPct;
    const prisma = usagePrisma({ durationSeconds: 5 * 60, todayMinutesAfter: threshold + 100 });
    await recordCallUsage(prisma, { practiceId: 'practice-1', vapiCallId: 'call-1' });
    expect(dispatchOpsAlert).not.toHaveBeenCalled();
  });
});
