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

describe('verifyPaymentFromSyncUpdate evidence rules', () => {
  it('does not credit a zero balance when nothing confirms an insurance payment', async () => {
    const { prisma, updates } = mockPrisma({ id: 'c1', practiceId: 'p1', status: 'IN_QUEUE' });
    const r = await verifyPaymentFromSyncUpdate(prisma, {
      practiceId: 'p1',
      claimId: 'c1',
      previousOutstanding: 500,
      newOutstanding: 0,
    });
    expect(r?.verified).toBe(false);
    expect(r?.evidence).toBeNull();
    expect(updates).toContainEqual({
      where: { id: 'c1' },
      data: { outstandingAmount: 0, recoveryRoute: 'STOP', paymentExpectedBy: null },
    });
    expect(prisma.claimRecoveryEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'BALANCE_CLEARED_UNVERIFIED' }),
      }),
    );
    expect(prisma.claimRecoveryEvent.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventType: 'PAYMENT_VERIFIED_SYNC' }) }),
    );
  });

  it('credits a zero balance when the export carries an insurance payment', async () => {
    const { prisma } = mockPrisma({ id: 'c1', practiceId: 'p1', status: 'IN_QUEUE' });
    const r = await verifyPaymentFromSyncUpdate(prisma, {
      practiceId: 'p1',
      claimId: 'c1',
      previousOutstanding: 500,
      newOutstanding: 0,
      insurancePaymentReported: true,
    });
    expect(r?.verified).toBe(true);
    expect(r?.evidence).toBe('insurance_payment_in_export');
  });

  it('labels a carrier-confirmed claim as carrier evidence', async () => {
    const { prisma } = mockPrisma({ id: 'c1', practiceId: 'p1', status: 'RESOLVED' });
    const r = await verifyPaymentFromSyncUpdate(prisma, {
      practiceId: 'p1',
      claimId: 'c1',
      previousOutstanding: 200,
      newOutstanding: 0,
    });
    expect(r?.verified).toBe(true);
    expect(r?.evidence).toBe('carrier_confirmed');
  });
});

describe('handlePartialPaymentSync wording', () => {
  it('does not describe an unconfirmed balance drop as money received', async () => {
    const { handlePartialPaymentSync } = await import('../../src/server/recovery/partialPaymentHandler.js');
    const create = vi.fn(async () => ({}));
    const prisma = {
      insuranceClaim: {
        findUnique: vi.fn(async () => ({ recoveryRoute: 'CALL_CARRIER', paymentExpectedBy: null, status: 'IN_QUEUE' })),
        update: vi.fn(async () => ({})),
      },
      claimRecoveryAction: { updateMany: vi.fn(async () => ({ count: 0 })), create },
      callQueue: { upsert: vi.fn(async () => ({})) },
      claimRecoveryEvent: { create: vi.fn(async () => ({})) },
    } as unknown as PrismaClient;

    await handlePartialPaymentSync(prisma, {
      practiceId: 'p1',
      claimId: 'c1',
      previousOutstanding: 500,
      newOutstanding: 300,
      amountRecoveredCents: 20_000,
      evidence: null,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Balance reduced — confirm what was paid',
          metadata: expect.objectContaining({ evidence: null }),
        }),
      }),
    );
  });
});
