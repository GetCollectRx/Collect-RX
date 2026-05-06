// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Insurance Analytics Unit Tests
// Uses mock Prisma client — no live DB required.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import {
  getTimeSaved,
  getDollarsRecovered,
  getCallVolumeOverTime,
} from '../../src/services/insurance-analytics';
import type { PrismaClient } from '@prisma/client';

const dateRange = {
  from: new Date('2024-01-01'),
  to:   new Date('2024-01-31'),
};

const practiceId = 'PRACTICE-001';

// ---------------------------------------------------------------------------
// getTimeSaved
// ---------------------------------------------------------------------------
describe('getTimeSaved', () => {
  it('returns correct hours for known call count', async () => {
    const mockPrisma = {
      callAttempt: {
        count: vi.fn().mockResolvedValue(10),
      },
    } as unknown as PrismaClient;

    const result = await getTimeSaved(mockPrisma, practiceId, dateRange);

    expect(result.completedCalls).toBe(10);
    expect(result.timeSavedMinutes).toBe(180);   // 10 × 18
    expect(result.timeSavedHours).toBe(3.0);
    expect(result.avgManualCallMinutes).toBe(18);
  });

  it('returns zero for no calls', async () => {
    const mockPrisma = {
      callAttempt: { count: vi.fn().mockResolvedValue(0) },
    } as unknown as PrismaClient;

    const result = await getTimeSaved(mockPrisma, practiceId, dateRange);
    expect(result.completedCalls).toBe(0);
    expect(result.timeSavedMinutes).toBe(0);
    expect(result.timeSavedHours).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getDollarsRecovered
// ---------------------------------------------------------------------------
describe('getDollarsRecovered', () => {
  it('sums outstanding amounts correctly', async () => {
    const mockPrisma = {
      insuranceClaim: {
        findMany: vi.fn().mockResolvedValue([
          { outstandingAmount: 450.00 },
          { outstandingAmount: 275.50 },
          { outstandingAmount: 820.00 },
        ]),
      },
    } as unknown as PrismaClient;

    const result = await getDollarsRecovered(mockPrisma, practiceId, dateRange);
    expect(result.resolvedClaimsCount).toBe(3);
    expect(result.dollarsRecovered).toBeCloseTo(1545.50);
    expect(result.currency).toBe('CAD');
  });

  it('returns zero for no resolved claims', async () => {
    const mockPrisma = {
      insuranceClaim: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const result = await getDollarsRecovered(mockPrisma, practiceId, dateRange);
    expect(result.dollarsRecovered).toBe(0);
    expect(result.resolvedClaimsCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getCallVolumeOverTime
// ---------------------------------------------------------------------------
describe('getCallVolumeOverTime', () => {
  it('returns a point per day in range with zeros filled', async () => {
    const mockPrisma = {
      callAttempt: {
        findMany: vi.fn().mockResolvedValue([
          { initiatedAt: new Date('2024-01-05'), outcome: 'RESOLVED' },
          { initiatedAt: new Date('2024-01-05'), outcome: 'PENDING' },
          { initiatedAt: new Date('2024-01-07'), outcome: 'FAILED' },
        ]),
      },
    } as unknown as PrismaClient;

    const range = { from: new Date('2024-01-05'), to: new Date('2024-01-07') };
    const result = await getCallVolumeOverTime(mockPrisma, practiceId, range, 'day');

    expect(result).toHaveLength(3);
    const jan5 = result.find((r) => r.date === '2024-01-05');
    expect(jan5?.calls).toBe(2);
    expect(jan5?.resolved).toBe(1);

    const jan6 = result.find((r) => r.date === '2024-01-06');
    expect(jan6?.calls).toBe(0);   // gap filled with zero

    const jan7 = result.find((r) => r.date === '2024-01-07');
    expect(jan7?.failed).toBe(1);
  });
});
