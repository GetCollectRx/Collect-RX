import { describe, expect, it, vi } from 'vitest';
import {
  ABSENT_FROM_EXPORT_EVENT,
  REAPPEARED_IN_EXPORT_EVENT,
  closeClaimsMissingFromFullExport,
  reopenIfReappeared,
} from '../src/server/pms/absentClaimHandler.js';

type OpenClaim = { id: string; claimNumber: string; outstandingAmount: number; recoveryRoute: string | null };

function prismaWith(open: OpenClaim[], latestEvent: { eventType: string; metadata: unknown } | null = null) {
  return {
    insuranceClaim: {
      findMany: vi.fn().mockResolvedValue(open),
      update: vi.fn().mockResolvedValue({}),
    },
    claimRecoveryEvent: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(latestEvent),
    },
  };
}

function claims(n: number): OpenClaim[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `id-${i}`,
    claimNumber: `CLM-${i}`,
    outstandingAmount: 100,
    recoveryRoute: 'CALL_CARRIER',
  }));
}

describe('closeClaimsMissingFromFullExport', () => {
  it('closes open claims that a full export no longer lists, and leaves listed ones alone', async () => {
    const prisma = prismaWith(claims(3));
    const result = await closeClaimsMissingFromFullExport(
      prisma as never,
      'practice-1',
      new Set(['CLM-0', 'CLM-2']),
    );

    expect(result).toEqual({ closed: 1, held: 0, warning: null });
    expect(prisma.insuranceClaim.update).toHaveBeenCalledTimes(1);
    expect(prisma.insuranceClaim.update).toHaveBeenCalledWith({
      where: { id: 'id-1' },
      data: { recoveryRoute: 'STOP' },
    });
    expect(prisma.claimRecoveryEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          claimId: 'id-1',
          eventType: ABSENT_FROM_EXPORT_EVENT,
          metadata: expect.objectContaining({ previousRoute: 'CALL_CARRIER' }),
        }),
      }),
    );
  });

  it('only looks at open, undeleted claims with a balance for this practice, excluding live calls', async () => {
    const prisma = prismaWith([]);
    await closeClaimsMissingFromFullExport(prisma as never, 'practice-1', new Set());
    const where = prisma.insuranceClaim.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ practiceId: 'practice-1', deletedAt: null, outstandingAmount: { gt: 0 } });
    expect(where.status.in).not.toContain('CALLING');
    expect(where.status.in).not.toContain('RESOLVED');
  });

  it('holds instead of closing when most open claims vanish at once (likely a filtered export)', async () => {
    const prisma = prismaWith(claims(20));
    const result = await closeClaimsMissingFromFullExport(prisma as never, 'practice-1', new Set(['CLM-0']));

    expect(result.closed).toBe(0);
    expect(result.held).toBe(19);
    expect(result.warning).toMatch(/19 of 20 open claims/);
    expect(prisma.insuranceClaim.update).not.toHaveBeenCalled();
  });

  it('still closes a large batch when it is a minority of open claims', async () => {
    const prisma = prismaWith(claims(40));
    const listed = new Set(claims(40).slice(0, 28).map((c) => c.claimNumber));
    const result = await closeClaimsMissingFromFullExport(prisma as never, 'practice-1', listed);
    expect(result.closed).toBe(12);
    expect(result.warning).toBeNull();
  });

  it('closes a few missing claims in a small practice even when they are most of its claims', async () => {
    const prisma = prismaWith(claims(3));
    const result = await closeClaimsMissingFromFullExport(prisma as never, 'practice-1', new Set());
    expect(result.closed).toBe(3);
  });
});

describe('reopenIfReappeared', () => {
  it('puts a claim closed only for being missing back into carrier follow-up', async () => {
    const prisma = prismaWith([], { eventType: ABSENT_FROM_EXPORT_EVENT, metadata: { previousRoute: null } });
    const reopened = await reopenIfReappeared(prisma as never, 'practice-1', 'id-1');

    expect(reopened).toBe(true);
    expect(prisma.insuranceClaim.update).toHaveBeenCalledWith({
      where: { id: 'id-1' },
      data: { recoveryRoute: 'CALL_CARRIER' },
    });
    expect(prisma.claimRecoveryEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventType: REAPPEARED_IN_EXPORT_EVENT }) }),
    );
  });

  it('restores a waiting route rather than forcing a call', async () => {
    const prisma = prismaWith([], { eventType: ABSENT_FROM_EXPORT_EVENT, metadata: { previousRoute: 'WAIT_SYNC' } });
    await reopenIfReappeared(prisma as never, 'practice-1', 'id-1');
    expect(prisma.insuranceClaim.update).toHaveBeenCalledWith({
      where: { id: 'id-1' },
      data: { recoveryRoute: 'WAIT_SYNC' },
    });
  });

  it('leaves claims closed for any other reason closed', async () => {
    const prisma = prismaWith([], { eventType: 'PAYMENT_VERIFIED_SYNC', metadata: null });
    const reopened = await reopenIfReappeared(prisma as never, 'practice-1', 'id-1');
    expect(reopened).toBe(false);
    expect(prisma.insuranceClaim.update).not.toHaveBeenCalled();
  });
});
