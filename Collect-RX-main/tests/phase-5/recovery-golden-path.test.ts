/**
 * Golden path: call outcome → practice gate → gate clear → sync verify → metrics.
 * Uses a lightweight in-memory Prisma stand-in (no DATABASE_URL required).
 */
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { routeClaimRecovery } from '../../src/server/recovery/claimRouter.js';
import { shouldSupersedeBlockingGate } from '../../src/server/recovery/gateSupersession.js';
import { transitionClaimRecovery } from '../../src/server/recovery/transitionClaimRecovery.js';
import { verifyPaymentFromSyncUpdate } from '../../src/server/recovery/paymentVerification.js';
import { computeRecoveryMetrics } from '../../src/server/recovery/recoveryMetrics.js';

vi.mock('../../src/server/emrSyncOutbox.js', () => ({
  enqueueEmrClaimEvent: vi.fn(async () => undefined),
}));

describe('recovery golden path', () => {
  it('resubmit gate survives no_answer then clears on processing supersession', () => {
    const noAnswerDecision = routeClaimRecovery({
      callOutcome: 'NO_ANSWER',
      outcomeDetail: 'Busy (legacy: no_answer)',
      gatedClaimStatus: 'IN_QUEUE',
      proposedClaimStatus: 'IN_QUEUE',
      outstandingCents: 50_000,
      carrierId: 'sun_life',
      daysOutstanding: 45,
      attemptCount: 2,
      hasBlockingPracticeGate: true,
      hasOpenCdcpCase: false,
      paymentCorroborated: false,
    });

    expect(
      shouldSupersedeBlockingGate('PRACTICE_RESUBMIT', noAnswerDecision, noAnswerDecision.actionDetail),
    ).toBe(false);

    const processingDecision = routeClaimRecovery({
      callOutcome: 'PENDING',
      outcomeDetail: 'In process (legacy: processing)',
      gatedClaimStatus: 'IN_QUEUE',
      proposedClaimStatus: 'IN_QUEUE',
      outstandingCents: 50_000,
      carrierId: 'sun_life',
      daysOutstanding: 45,
      attemptCount: 2,
      hasBlockingPracticeGate: true,
      hasOpenCdcpCase: false,
      paymentCorroborated: false,
    });

    expect(
      shouldSupersedeBlockingGate('PRACTICE_RESUBMIT', processingDecision, 'In process (legacy: processing)'),
    ).toBe(true);
  });

  it('gate clear → sync verify records PAYMENT_VERIFIED_SYNC and updates metrics', async () => {
    const store = createRecoveryStore();
    const prisma = store.prisma as unknown as PrismaClient;

    await transitionClaimRecovery(prisma, {
      practiceId: 'p1',
      claimId: 'c1',
      kind: 'GATE_CLEARED',
      actionId: 'gate-1',
    });

    expect(store.claim.status).toBe('IN_QUEUE');
    expect(store.claim.recoveryRoute).toBe('CALL_CARRIER');
    expect(store.events.some((e) => e.eventType === 'GATE_CLEARED')).toBe(true);

    store.claim.status = 'APPROVED_PENDING_PAYMENT';
    store.claim.recoveryRoute = 'WAIT_SYNC';
    store.claim.outstandingAmount = 500;

    await verifyPaymentFromSyncUpdate(prisma, {
      practiceId: 'p1',
      claimId: 'c1',
      previousOutstanding: 500,
      newOutstanding: 0,
    });

    expect(store.claim.status).toBe('RESOLVED');
    expect(store.claim.recoveryRoute).toBe('STOP');
    expect(store.events.some((e) => e.eventType === 'PAYMENT_VERIFIED_SYNC')).toBe(true);

    const metrics = await computeRecoveryMetrics(prisma, 'p1');
    expect(metrics.paymentsVerifiedBySync).toBeGreaterThanOrEqual(1);
    expect(metrics.dollarsRecoveredSyncVerified).toBeGreaterThan(0);
  });

  it('manual payment confirm emits MANUAL_PAYMENT_CONFIRMED event', async () => {
    const store = createRecoveryStore();
    const prisma = store.prisma as unknown as PrismaClient;

    await transitionClaimRecovery(prisma, {
      practiceId: 'p1',
      claimId: 'c1',
      kind: 'MANUAL_PAYMENT_CONFIRMED',
      notes: 'Check received',
    });

    expect(store.claim.status).toBe('RESOLVED');
    expect(store.claim.recoveryRoute).toBe('STOP');
    expect(store.events.some((e) => e.eventType === 'MANUAL_PAYMENT_CONFIRMED')).toBe(true);
  });
});

function createRecoveryStore() {
  const claim = {
    id: 'c1',
    practiceId: 'p1',
    carrierId: 'sun_life' as const,
    claimNumber: 'CL-100',
    outstandingAmount: 500,
    status: 'ON_HOLD' as const,
    recoveryRoute: 'PRACTICE_GATE' as const,
    paymentExpectedBy: null as Date | null,
  };

  const gate = {
    id: 'gate-1',
    practiceId: 'p1',
    claimId: 'c1',
    actionType: 'PRACTICE_RESUBMIT' as const,
    status: 'BLOCKING' as const,
    clearedAt: null as Date | null,
  };

  const events: Array<{
    eventType: string;
    amountRecoveredCents?: number | null;
    practiceId: string;
    claimId: string;
    createdAt?: Date;
  }> = [];

  const queue = { claimId: 'c1', status: 'ESCALATED' as const, scheduledFor: new Date(0) };

  // Mirrors Prisma's `{ eventType: 'X' }` and `{ eventType: { in: ['X', 'Y'] } }`.
  function matchesEventType(actual: string, filter: unknown): boolean {
    if (filter == null) return true;
    if (typeof filter === 'string') return actual === filter;
    if (typeof filter === 'object' && 'in' in (filter as Record<string, unknown>)) {
      return (filter as { in: string[] }).in.includes(actual);
    }
    return true;
  }

  const prisma = {
    insuranceClaim: {
      findUnique: vi.fn(async () => ({ ...claim, queueEntry: queue })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(claim, data);
        return claim;
      }),
      aggregate: vi.fn(async () => ({
        _sum: { outstandingAmount: claim.outstandingAmount },
        _count: 1,
      })),
      count: vi.fn(async () => 0),
    },
    claimRecoveryAction: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.id === gate.id && gate.status === 'BLOCKING') return gate;
        return null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        if (where.id === gate.id) Object.assign(gate, data);
        return gate;
      }),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (data.status === 'CLEARED') {
          gate.status = 'CLEARED';
          gate.clearedAt = data.clearedAt as Date;
        }
        return { count: 1 };
      }),
      count: vi.fn(async () => 0),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === gate.id ? { ...gate, createdAt: new Date(Date.now() - 86_400_000) } : null,
      ),
    },
    callQueue: {
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(queue, data);
        return { count: 1 };
      }),
    },
    claimRecoveryEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        events.push({ ...(data as typeof events[number]), createdAt: new Date() });
        return { id: `ev-${events.length}` };
      }),
      aggregate: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const matching = events.filter((e) => {
          if (!matchesEventType(e.eventType, where.eventType)) return false;
          if (where.practiceId && e.practiceId !== where.practiceId) return false;
          if (where.createdAt && typeof where.createdAt === 'object' && 'gte' in where.createdAt) {
            const gte = (where.createdAt as { gte: Date }).gte;
            if (e.createdAt && e.createdAt < gte) return false;
          }
          return true;
        });
        const sum = matching.reduce((s, e) => s + (e.amountRecoveredCents ?? 0), 0);
        return { _sum: { amountRecoveredCents: sum }, _count: matching.length };
      }),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        events.filter((e) => {
          if (!matchesEventType(e.eventType, where.eventType)) return false;
          if (where.createdAt && typeof where.createdAt === 'object' && 'gte' in where.createdAt) {
            const gte = (where.createdAt as { gte: Date }).gte;
            if (e.createdAt && e.createdAt < gte) return false;
          }
          return true;
        }).length,
      ),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        events
          .filter((e) => {
            if (!matchesEventType(e.eventType, where.eventType)) return false;
            if (where.practiceId && e.practiceId !== where.practiceId) return false;
            return true;
          })
          .map((e) => ({
            claimId: e.claimId,
            createdAt: e.createdAt ?? new Date(),
            metadata: {},
          })),
      ),
      findFirst: vi.fn(async () => null),
    },
    $transaction: vi.fn(async (ops: unknown[]) => {
      for (const op of ops) {
        if (op && typeof (op as Promise<unknown>).then === 'function') await op;
      }
    }),
  };

  return { prisma, claim, gate, events, queue };
}
