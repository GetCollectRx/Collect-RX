import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { getClaimRecoverySummary } from '../../src/server/recovery/claimRecoverySummary.js';

describe('getClaimRecoverySummary', () => {
  it('returns route and open actions for a claim', async () => {
    const prisma = {
      practice: {
        findUnique: vi.fn(async () => ({ recoveryMode: 'CSV_FIRST' })),
      },
      insuranceClaim: {
        findFirst: vi.fn(async () => ({
          id: 'c1',
          claimNumber: 'CL-100',
          status: 'ON_HOLD',
          recoveryRoute: 'PRACTICE_GATE',
          outstandingAmount: 500,
          paymentExpectedBy: null,
          queueEntry: { status: 'ESCALATED', attempts: 2, scheduledFor: new Date('2026-06-01') },
          recoveryActions: [
            {
              id: 'a1',
              actionType: 'PRACTICE_RESUBMIT',
              status: 'BLOCKING',
              title: 'Resubmit claim',
              detail: 'Carrier has no record',
              scheduledRecallAt: null,
              createdAt: new Date(),
            },
          ],
          recoveryEvents: [],
        })),
        findUnique: vi.fn(async () => ({
          recoveryRoute: 'PRACTICE_GATE',
          status: 'ON_HOLD',
          queueEntry: { scheduledFor: new Date('2026-06-01'), status: 'ESCALATED' },
        })),
      },
      claimRecoveryAction: {
        findFirst: vi.fn(async () => ({ title: 'Resubmit claim', actionType: 'PRACTICE_RESUBMIT' })),
        findMany: vi.fn(async () => []),
      },
      claimRecoveryEvent: { findMany: vi.fn(async () => []) },
      cdcpReconsiderationCase: { findFirst: vi.fn(async () => null) },
    } as unknown as PrismaClient;

    const summary = await getClaimRecoverySummary(prisma, 'p1', 'c1');
    expect(summary?.recoveryRoute).toBe('PRACTICE_GATE');
    expect(summary?.openActions).toHaveLength(1);
    expect(summary?.stopCalling).toBe(true);
    expect(summary?.canCallCarrier).toBe(false);
  });
});
