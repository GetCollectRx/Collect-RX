import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { transitionClaimRecovery } from '../../src/server/recovery/transitionClaimRecovery.js';

vi.mock('../../src/server/emrSyncOutbox.js', () => ({
  enqueueEmrClaimEvent: vi.fn(async () => undefined),
}));

describe('transitionClaimRecovery', () => {
  it('MANUAL_ESCALATION_RESOLVED sets STOP route and emits event', async () => {
    const claim = {
      id: 'c1',
      practiceId: 'p1',
      outstandingAmount: 200,
      status: 'ESCALATED' as const,
      recoveryRoute: 'PRACTICE_GATE' as const,
      paymentExpectedBy: null,
    };
    const events: string[] = [];

    const prisma = {
      insuranceClaim: {
        findUnique: vi.fn(async () => ({ ...claim, queueEntry: null })),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(claim, data);
          return claim;
        }),
      },
      claimRecoveryAction: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      callQueue: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      claimRecoveryEvent: {
        create: vi.fn(async ({ data }: { data: { eventType: string } }) => {
          events.push(data.eventType);
          return {};
        }),
      },
    } as unknown as PrismaClient;

    const result = await transitionClaimRecovery(prisma, {
      practiceId: 'p1',
      claimId: 'c1',
      kind: 'MANUAL_ESCALATION_RESOLVED',
      notes: 'Spoke with supervisor',
    });

    expect(result.recoveryRoute).toBe('STOP');
    expect(result.claimStatus).toBe('RESOLVED');
    expect(events).toContain('MANUAL_ESCALATION_RESOLVED');
  });
});
