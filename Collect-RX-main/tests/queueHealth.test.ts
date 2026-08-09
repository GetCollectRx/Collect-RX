import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

vi.mock('../src/carriers/adapter.js', () => ({
  isWithinCallWindow: vi.fn(() => true),
}));
vi.mock('../src/server/db/rlsContext.js', () => ({
  runWithRlsBypass: (fn: () => Promise<unknown>) => fn(),
}));
vi.mock('../src/server/frontDesk/queueEngine.js', () => ({
  getDeskQueueTickHealth: vi.fn(() => ({
    lastSuccessfulTickAt: null,
    consecutiveTickFailures: 0,
    lastTickFailureAt: null,
  })),
}));

import {
  getQueueHealth,
  evaluateQueueHealthAlerts,
  type QueueHealthSnapshot,
} from '../src/server/observability/queueHealth.js';

const THRESHOLDS = { stallMinutes: 30, stuckAttemptMinutes: 150 };

function snapshot(overrides: Partial<QueueHealthSnapshot>): QueueHealthSnapshot {
  return {
    duePendingCount: 0,
    oldestDuePendingAgeMinutes: null,
    openCallAttempts: 0,
    oldestOpenAttemptAgeMinutes: null,
    withinCallWindow: true,
    lastSuccessfulTickAt: null,
    consecutiveTickFailures: 0,
    lastTickFailureAt: null,
    ...overrides,
  };
}

describe('evaluateQueueHealthAlerts', () => {
  it('alerts when due claims age past the stall threshold inside the call window', () => {
    const alerts = evaluateQueueHealthAlerts(
      snapshot({ duePendingCount: 12, oldestDuePendingAgeMinutes: 45 }),
      THRESHOLDS,
    );
    expect(alerts.map((a) => a.alertId)).toEqual(['queue_dispatch_stalled']);
    expect(alerts[0].detail).toContain('45 min');
  });

  it('stays quiet about waiting claims outside the call window', () => {
    const alerts = evaluateQueueHealthAlerts(
      snapshot({
        duePendingCount: 12,
        oldestDuePendingAgeMinutes: 900,
        withinCallWindow: false,
      }),
      THRESHOLDS,
    );
    expect(alerts).toEqual([]);
  });

  it('alerts on a call attempt stuck longer than the threshold', () => {
    const alerts = evaluateQueueHealthAlerts(
      snapshot({ openCallAttempts: 1, oldestOpenAttemptAgeMinutes: 160 }),
      THRESHOLDS,
    );
    expect(alerts.map((a) => a.alertId)).toEqual(['call_attempt_stuck']);
  });

  it('reports a healthy queue as no alerts', () => {
    const alerts = evaluateQueueHealthAlerts(
      snapshot({
        duePendingCount: 3,
        oldestDuePendingAgeMinutes: 2,
        openCallAttempts: 1,
        oldestOpenAttemptAgeMinutes: 12,
      }),
      THRESHOLDS,
    );
    expect(alerts).toEqual([]);
  });
});

describe('getQueueHealth', () => {
  it('computes ages in minutes from the oldest due entry and oldest open attempt', async () => {
    const now = Date.now();
    const prisma = {
      callQueue: {
        count: vi.fn(async () => 4),
        findFirst: vi.fn(async () => ({ scheduledFor: new Date(now - 42 * 60_000) })),
      },
      callAttempt: {
        count: vi.fn(async () => 1),
        findFirst: vi.fn(async () => ({ initiatedAt: new Date(now - 10 * 60_000) })),
      },
    };

    const health = await getQueueHealth(prisma as unknown as PrismaClient);

    expect(health.duePendingCount).toBe(4);
    expect(health.oldestDuePendingAgeMinutes).toBeGreaterThanOrEqual(41);
    expect(health.oldestDuePendingAgeMinutes).toBeLessThanOrEqual(42);
    expect(health.openCallAttempts).toBe(1);
    expect(health.oldestOpenAttemptAgeMinutes).toBeGreaterThanOrEqual(9);
    expect(health.withinCallWindow).toBe(true);
    expect(health.lastSuccessfulTickAt).toBeNull();
    expect(health.consecutiveTickFailures).toBe(0);
  });

  it('returns null ages on an empty queue', async () => {
    const prisma = {
      callQueue: { count: vi.fn(async () => 0), findFirst: vi.fn(async () => null) },
      callAttempt: { count: vi.fn(async () => 0), findFirst: vi.fn(async () => null) },
    };

    const health = await getQueueHealth(prisma as unknown as PrismaClient);

    expect(health.oldestDuePendingAgeMinutes).toBeNull();
    expect(health.oldestOpenAttemptAgeMinutes).toBeNull();
  });
});
