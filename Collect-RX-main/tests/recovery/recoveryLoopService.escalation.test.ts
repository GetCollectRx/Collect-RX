import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { RecoveryDecision } from '../../src/server/recovery/types.js';

// Regression for OUTSTANDING-FIXES-PRODUCT-READY.md P10-04: the dedicated
// Escalations page (front-desk queue) reads call_escalations, not
// insurance_claims.status. applyRecoveryAfterCall is the primary real-call
// path that can route a claim to ESCALATED (appeal_required, fruitless-retry
// ladder, CDCP reconsideration, etc. — see claimRouter.ts's decision table)
// and it previously wrote insurance_claims.status + claim_recovery_actions
// but never call_escalations, so any claim escalated by a real completed
// call was invisible on /escalations. queueEngine.ts had the same gap for
// its own (narrower) pre-dispatch guard codes — fixed separately there.

const routeClaimRecoveryMock = vi.fn();

vi.mock('../../src/server/recovery/claimRouter.js', () => ({
  routeClaimRecovery: (...args: unknown[]) => routeClaimRecoveryMock(...args),
  routeForPaymentTraceRecall: vi.fn(),
}));

vi.mock('../../src/server/recovery/cdcpRecoveryBridge.js', () => ({
  hasOpenCdcpCaseForClaim: vi.fn(async () => false),
  primaryProcedureFromTreatmentCodes: vi.fn(() => null),
  ensureCdcpCaseForClaim: vi.fn(),
  linkRecoveryActionToCdcpCase: vi.fn(),
}));

vi.mock('../../src/server/recovery/holdLedger.js', () => ({
  getCarrierHoldStats: vi.fn(async () => ({ dumpRate: 0 })),
  HOLD_DUMP_ESCALATE_RATE: 0.5,
}));

vi.mock('../../src/server/recovery/gateSupersession.js', () => ({
  shouldSupersedeBlockingGate: () => false,
  shouldSupersedeOpenAction: () => false,
  isPracticeGateHoldDecision: () => true, // skip superseding — not under test here
}));

const { applyRecoveryAfterCall } = await import('../../src/server/recovery/recoveryLoopService.js');

function escalatedDecision(overrides: Partial<RecoveryDecision> = {}): RecoveryDecision {
  return {
    route: 'PRACTICE_GATE',
    claimStatus: 'ESCALATED',
    queueStatus: 'ESCALATED',
    scheduledRecallAt: null,
    recoveryActionType: 'HUMAN_ESCALATION',
    actionTitle: 'Appeal required',
    actionDetail: 'Carrier requires a written appeal — reference #APL-9912.',
    paymentExpectedBy: null,
    openCdcpCase: false,
    stopCalling: true,
    reason: 'appeal_required (non-CDCP)',
    ...overrides,
  };
}

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    claim: {
      id: 'claim-1',
      practiceId: 'p1',
      carrierId: 'sun_life',
      claimNumber: 'CN-1',
      patientToken: 'tok-1',
      treatmentCodes: null,
      outstandingAmount: 2700,
      daysOutstanding: 84,
      status: 'IN_QUEUE' as const,
    },
    attemptId: 'attempt-1',
    processed: { outcome: 'ESCALATED', outcomeDetail: 'Appeal required.' },
    structuredClaimStatus: null,
    gatedClaimStatus: 'ESCALATED' as const,
    proposedClaimStatus: 'ESCALATED' as const,
    paymentCorroborated: false,
    completedAt: new Date(),
    ...overrides,
  };
}

function prismaMock(existingEscalation: unknown = null) {
  const tx = {
    insuranceClaim: { update: vi.fn(async () => ({})) },
    callQueue: { upsert: vi.fn(async () => ({})) },
    claimRecoveryAction: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: 'action-1', title: 'Appeal required', detail: null })),
      update: vi.fn(async () => ({})),
    },
    callEscalation: {
      findFirst: vi.fn(async () => existingEscalation),
      create: vi.fn(async () => ({ id: 'esc-1' })),
    },
    claimRecoveryEvent: { create: vi.fn(async () => ({})) },
  };
  const prisma = {
    callQueue: { findUnique: vi.fn(async () => ({ attempts: 2 })) },
    claimRecoveryAction: { count: vi.fn(async () => 0) },
    callAttempt: { count: vi.fn(async () => 0) },
    $transaction: vi.fn(async (cb: (tx: typeof tx) => unknown) => cb(tx)),
  };
  return { prisma, tx };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('applyRecoveryAfterCall — call_escalations sync', () => {
  it('writes a call_escalations row when the decision escalates the claim', async () => {
    routeClaimRecoveryMock.mockReturnValue(escalatedDecision());
    const { prisma, tx } = prismaMock(null);

    await applyRecoveryAfterCall(prisma as unknown as PrismaClient, baseParams() as never);

    expect(tx.insuranceClaim.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ESCALATED' }) }),
    );
    expect(tx.callEscalation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        claimId: 'claim-1',
        practiceId: 'p1',
        carrierId: 'sun_life',
        reason: 'Carrier requires a written appeal — reference #APL-9912.',
        status: 'open',
      }),
    });
  });

  it('does not duplicate an already-open escalation with the same reason', async () => {
    routeClaimRecoveryMock.mockReturnValue(escalatedDecision());
    const { prisma, tx } = prismaMock({ id: 'existing-esc' });

    await applyRecoveryAfterCall(prisma as unknown as PrismaClient, baseParams() as never);

    expect(tx.callEscalation.create).not.toHaveBeenCalled();
  });

  it('does not write call_escalations for a non-escalating decision', async () => {
    routeClaimRecoveryMock.mockReturnValue(
      escalatedDecision({ claimStatus: 'IN_QUEUE', queueStatus: 'PENDING', route: 'CALL_CARRIER', stopCalling: false }),
    );
    const { prisma, tx } = prismaMock(null);

    await applyRecoveryAfterCall(prisma as unknown as PrismaClient, baseParams() as never);

    expect(tx.callEscalation.create).not.toHaveBeenCalled();
  });
});
