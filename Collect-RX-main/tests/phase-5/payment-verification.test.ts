import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { verifyPaymentFromSyncUpdate } from '../../src/server/recovery/paymentVerification.js';

function mockPrisma(claim: Record<string, unknown> | null) {
  const updates: unknown[] = [];
  return {
    updates,
    prisma: {
      insuranceClaim: {
        findUnique: vi.fn(async () => claim),
        update: vi.fn(async (args: unknown) => {
          updates.push(args);
          return {};
        }),
      },
      callQueue: { updateMany: vi.fn(async () => ({ count: 1 })) },
      claimRecoveryAction: { updateMany: vi.fn(async () => ({ count: 0 })) },
      claimRecoveryEvent: { create: vi.fn(async () => ({})),
      },
      $transaction: vi.fn(async (ops: unknown[]) => {
        for (const op of ops) {
          if (typeof op === 'function') await op();
          else await op;
        }
      }),
    } as unknown as PrismaClient,
  };
}

describe('verifyPaymentFromSyncUpdate', () => {
  it('closes loop when outstanding drops to zero', async () => {
    const { prisma, updates } = mockPrisma({
      id: 'c1',
      practiceId: 'p1',
      status: 'APPROVED_PENDING_PAYMENT',
    });
    const r = await verifyPaymentFromSyncUpdate(prisma, {
      practiceId: 'p1',
      claimId: 'c1',
      previousOutstanding: 500,
      newOutstanding: 0,
    });
    expect(r?.verified).toBe(true);
    expect(r?.amountRecoveredCents).toBe(50_000);
    expect(prisma.claimRecoveryEvent.create).toHaveBeenCalled();
    expect(updates.length).toBeGreaterThan(0);
  });

  it('returns null when balance unchanged', async () => {
    const { prisma } = mockPrisma({
      id: 'c1',
      practiceId: 'p1',
      status: 'IN_QUEUE',
    });
    const r = await verifyPaymentFromSyncUpdate(prisma, {
      practiceId: 'p1',
      claimId: 'c1',
      previousOutstanding: 500,
      newOutstanding: 500,
    });
    expect(r).toBeNull();
  });
});
