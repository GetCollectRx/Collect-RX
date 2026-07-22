import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { compensateFailedManualDispatch } from '../../src/server/insurance/manualDispatchCompensation.js';

describe('compensateFailedManualDispatch', () => {
  it('terminates Vapi and atomically restores the prior claim and queue state', async () => {
    const insuranceClaim = { update: vi.fn().mockResolvedValue({}) };
    const callQueue = {
      update: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    };
    const transaction = vi.fn(async (callback: (tx: typeof prisma) => Promise<void>) => callback(prisma));
    const prisma = {
      insuranceClaim,
      callQueue,
      $transaction: transaction,
    };
    const terminateCall = vi.fn().mockResolvedValue(undefined);
    const lastAttemptAt = new Date('2026-07-10T14:00:00.000Z');
    const deferredAt = new Date('2026-07-10T13:00:00.000Z');

    const result = await compensateFailedManualDispatch(prisma as unknown as PrismaClient, {
      claimId: 'claim-1',
      vapiCallId: 'vapi-1',
      reservation: {
        claimStatus: 'IN_QUEUE',
        queue: {
          attempts: 1,
          status: 'PENDING',
          lastAttemptAt,
          dispatchDeferralCode: 'CLAIM_DATA_UNAVAILABLE',
          dispatchDeferralNextAction: 'Re-import claim data',
          dispatchDeferredAt: deferredAt,
        },
      },
      terminateCall,
    });

    expect(result.terminationError).toBeNull();
    expect(terminateCall).toHaveBeenCalledWith('vapi-1');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(insuranceClaim.update).toHaveBeenCalledWith({
      where: { id: 'claim-1' },
      data: { status: 'IN_QUEUE' },
    });
    expect(callQueue.update).toHaveBeenCalledWith({
      where: { claimId: 'claim-1' },
      data: {
        attempts: 1,
        status: 'PENDING',
        lastAttemptAt,
        dispatchDeferralCode: 'CLAIM_DATA_UNAVAILABLE',
        dispatchDeferralNextAction: 'Re-import claim data',
        dispatchDeferredAt: deferredAt,
      },
    });
    expect(callQueue.deleteMany).not.toHaveBeenCalled();
  });

  it('restores local state even if Vapi termination fails', async () => {
    const insuranceClaim = { update: vi.fn().mockResolvedValue({}) };
    const callQueue = {
      update: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const prisma = {
      insuranceClaim,
      callQueue,
      $transaction: vi.fn(async (callback: (tx: typeof prisma) => Promise<void>) => callback(prisma)),
    };
    const terminationFailure = new Error('Vapi unavailable');

    const result = await compensateFailedManualDispatch(prisma as unknown as PrismaClient, {
      claimId: 'claim-1',
      vapiCallId: 'vapi-1',
      reservation: { claimStatus: 'PENDING', queue: null },
      terminateCall: vi.fn().mockRejectedValue(terminationFailure),
    });

    expect(result.terminationError).toBe(terminationFailure);
    expect(insuranceClaim.update).toHaveBeenCalledWith({
      where: { id: 'claim-1' },
      data: { status: 'PENDING' },
    });
    expect(callQueue.deleteMany).toHaveBeenCalledWith({ where: { claimId: 'claim-1' } });
  });
});
