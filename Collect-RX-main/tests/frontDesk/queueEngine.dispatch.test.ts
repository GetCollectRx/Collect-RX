import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const validateDispatchMock = vi.fn();
const initiateCallMock = vi.fn();
const detokenizeMock = vi.fn();
const probeClaimStatusMock = vi.fn();
const canMakeCallMock = vi.fn();
const completenessMock = vi.fn();
const raiseGateMock = vi.fn();
const transitionClaimRecoveryMock = vi.fn();

vi.mock('../../src/carriers/adapter.js', () => ({
  validateDispatch: (...args: unknown[]) => validateDispatchMock(...args),
  isWithinCallWindow: () => true,
  CARRIER_CONFIGS: {
    sun_life: {
      carrierId: 'sun_life',
      displayName: 'Sun Life Financial',
      phone: '+18005550100',
      ivrHints: ['Press 2 for dental claims'],
    },
    manulife: {
      carrierId: 'manulife',
      displayName: 'Manulife',
      phone: '+18005550101',
      ivrHints: ['Press 1 for claims'],
    },
  },
}));

vi.mock('../../src/vapi/client.js', () => ({
  initiateCall: (...args: unknown[]) => initiateCallMock(...args),
  endVapiCall: vi.fn(),
}));

vi.mock('../../src/server/frontDesk/deskQueueBroadcast.js', () => ({
  refreshDeskQueueBroadcast: vi.fn(),
}));

vi.mock('../../src/server/frontDesk/deskWs.js', () => ({
  broadcastDesk: vi.fn(),
}));

vi.mock('../../src/server/frontDesk/deskMappers.js', () => ({
  mapActiveCall: vi.fn(() => ({})),
}));

vi.mock('../../src/server/plans/planBridge.js', () => ({
  canMakeCall: (...args: unknown[]) => canMakeCallMock(...args),
}));

vi.mock('../../src/server/services/practiceSettingsService.js', () => ({
  getPracticeSettings: vi.fn(async () => ({
    voiceAgentEnabled: true,
    billingPhone: '416-555-0100',
    escalationPhoneNumber: '416-555-0101',
    carrierConfigs: [],
  })),
}));

vi.mock('../../src/pii-vault.js', () => ({
  piiVault: { detokenize: (...args: unknown[]) => detokenizeMock(...args) },
}));

vi.mock('../../src/server/frontDesk/patientDataCompleteness.js', () => ({
  checkPatientDataCompleteness: (...args: unknown[]) => completenessMock(...args),
  raiseMissingPatientDataGate: (...args: unknown[]) => raiseGateMock(...args),
}));

vi.mock('../../src/server/triage/claimStatusProbe.js', () => ({
  probeClaimStatus: (...args: unknown[]) => probeClaimStatusMock(...args),
}));

vi.mock('../../src/server/recovery/transitionClaimRecovery.js', () => ({
  transitionClaimRecovery: (...args: unknown[]) => transitionClaimRecoveryMock(...args),
}));

vi.mock('../../src/server/learning/carrierLessons.js', () => ({
  getApprovedNavigationNotes: vi.fn(async () => ''),
}));

vi.mock('../../src/server/discovery/carrierDiscoveryService.js', () => ({
  getPublishedNavigationSteps: vi.fn(async () => []),
}));

vi.mock('../../src/server/db/rlsContext.js', () => ({
  runWithPracticeRls: (_practiceId: string, fn: () => Promise<unknown>) => fn(),
  runWithRlsBypass: (fn: () => Promise<unknown>) => fn(),
}));

vi.mock('../../src/logger.cjs', () => ({
  default: { warn: vi.fn(), error: vi.fn(), audit: vi.fn() },
}));

import { runDeskQueueTick } from '../../src/server/frontDesk/queueEngine.js';

interface QueueEntryFixture {
  id: string;
  practiceId: string;
  claimId: string;
  attempts: number;
  scheduledFor: Date;
  claim: Record<string, unknown>;
}

function queueEntry(id: string, claimOverrides: Record<string, unknown> = {}): QueueEntryFixture {
  return {
    id: `q-${id}`,
    practiceId: 'p1',
    claimId: `claim-${id}`,
    attempts: 0,
    scheduledFor: new Date(Date.now() - 60_000),
    claim: {
      id: `claim-${id}`,
      carrierId: 'sun_life',
      claimNumber: `CN-${id}`,
      billedAmount: 250,
      outstandingAmount: 250,
      expectedAmount: null,
      daysOutstanding: 45,
      servicedAt: null,
      submittedAt: null,
      treatmentCodes: null,
      patientToken: `tok-${id}`,
      status: 'IN_QUEUE',
      ...claimOverrides,
    },
  };
}

function tickPrisma(candidates: QueueEntryFixture[]) {
  const prisma = {
    // runDeskQueueTick fetches the ordered practice list via $queryRaw
    // (orderPracticesByFairness) and claims the fleet-wide lease via
    // $executeRaw (claimTickLease) — tests that need to control which
    // practices are iterated, and in what order, override $queryRaw the
    // same way they used to override practice.findMany.
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => [{ id: 'p1' }]),
    practice: {
      findMany: vi.fn(async () => [{ id: 'p1' }]),
      findUnique: vi.fn(async () => ({
        name: 'CollectRx Demo Practice',
        billingPhone: '416-555-0100',
        npi: null,
        taxId: null,
        practiceAddress: null,
      })),
    },
    practiceDeskState: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async () => ({})),
    },
    callQueue: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => candidates),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    callAttempt: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'attempt-1' })),
      update: vi.fn(async () => ({})),
    },
    insuranceClaim: {
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    callEscalation: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({
        id: 'escalation-1',
        practiceId: 'p1',
        claimId: 'claim-1',
        claimRef: 'CN-1',
        carrierId: 'sun_life',
        amountClaimedCents: 25000,
        reason: 'Maximum automated call attempts reached',
        callAttemptId: null,
        attemptNumber: 3,
        status: 'open',
        resolution: null,
        resolvedByStaffId: null,
        resolvedAt: null,
        resolutionNotes: null,
        createdAt: new Date(),
      })),
    },
    claimRecoveryEvent: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return prisma;
}

function phiSuccess() {
  return {
    success: true,
    phi: {
      patientName: 'Test Patient',
      dateOfBirth: '1990-01-01',
      subscriberId: 'SUB-1',
      groupPolicyNumber: 'GRP-1',
      subscriberName: 'Test Patient',
      subscriberDateOfBirth: '1990-01-01',
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  canMakeCallMock.mockResolvedValue({ allowed: true });
  probeClaimStatusMock.mockResolvedValue(null);
  detokenizeMock.mockReturnValue(phiSuccess());
  initiateCallMock.mockResolvedValue({ vapiCallId: 'vapi-1' });
  completenessMock.mockReturnValue({ ok: true, missing: [], warnings: [] });
  raiseGateMock.mockResolvedValue({ raised: true });
});

describe('runDeskQueueTick head-of-queue settlement', () => {
  it('parks a carrier-blocked head claim as BLOCKED and dispatches the next eligible claim in the same tick', async () => {
    const blocked = queueEntry('1');
    const eligible = queueEntry('2', { carrierId: 'manulife' });
    const prisma = tickPrisma([blocked, eligible]);

    validateDispatchMock
      .mockResolvedValueOnce({ allowed: false, code: 'CARRIER_BLOCK', reason: 'CARRIER_BLOCK active' })
      .mockResolvedValueOnce({ allowed: true });

    await runDeskQueueTick(prisma as unknown as PrismaClient);

    expect(prisma.callQueue.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'q-1' },
      data: expect.objectContaining({
        status: 'BLOCKED',
        dispatchDeferralCode: 'CARRIER_BLOCK',
      }),
    }));
    expect(prisma.insuranceClaim.updateMany).toHaveBeenCalledWith({
      where: { id: 'claim-1', status: { in: ['PENDING', 'IN_QUEUE', 'CALLING'] } },
      data: { status: 'BLOCKED' },
    });
    expect(initiateCallMock).toHaveBeenCalledTimes(1);
    expect(initiateCallMock.mock.calls[0][0]).toMatchObject({ claimId: 'claim-2' });
  });

  it('escalates a max-attempts head claim and dispatches the next eligible claim', async () => {
    const exhausted = queueEntry('1');
    exhausted.attempts = 3;
    const eligible = queueEntry('2');
    const prisma = tickPrisma([exhausted, eligible]);

    validateDispatchMock
      .mockResolvedValueOnce({ allowed: false, code: 'MAX_ATTEMPTS', reason: 'Maximum 3 call attempts reached' })
      .mockResolvedValueOnce({ allowed: true });

    await runDeskQueueTick(prisma as unknown as PrismaClient);

    expect(prisma.insuranceClaim.update).toHaveBeenCalledWith({
      where: { id: 'claim-1' },
      data: { status: 'ESCALATED' },
    });
    expect(prisma.callQueue.update).toHaveBeenCalledWith({
      where: { id: 'q-1' },
      data: { status: 'ESCALATED' },
    });
    expect(prisma.callEscalation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        claimId: 'claim-1',
        reason: 'Maximum automated call attempts reached',
        attemptNumber: 3,
      }),
    });
    expect(initiateCallMock).toHaveBeenCalledTimes(1);
    expect(initiateCallMock.mock.calls[0][0]).toMatchObject({ claimId: 'claim-2' });
  });

  // Regression for OUTSTANDING-FIXES-PRODUCT-READY.md P10-04: this guard code
  // shared the same switch case as MAX_ATTEMPTS but the call_escalations write
  // was gated to MAX_ATTEMPTS only, so 90-day-aged claims were marked ESCALATED
  // everywhere except the dedicated Escalations page, which reads that table.
  it('escalates an over-90-days head claim, writes a call_escalations row, and dispatches the next eligible claim', async () => {
    const aged = queueEntry('1', { daysOutstanding: 94 });
    const eligible = queueEntry('2');
    const prisma = tickPrisma([aged, eligible]);

    validateDispatchMock
      .mockResolvedValueOnce({
        allowed: false,
        code: 'ESCALATE_OVER_90',
        reason: 'Claim 94 days outstanding — escalate to human (> 90 days rule)',
      })
      .mockResolvedValueOnce({ allowed: true });

    await runDeskQueueTick(prisma as unknown as PrismaClient);

    expect(prisma.insuranceClaim.update).toHaveBeenCalledWith({
      where: { id: 'claim-1' },
      data: { status: 'ESCALATED' },
    });
    expect(prisma.callQueue.update).toHaveBeenCalledWith({
      where: { id: 'q-1' },
      data: { status: 'ESCALATED' },
    });
    expect(prisma.callEscalation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        claimId: 'claim-1',
        reason: 'Claim 94 days outstanding — escalate to human (> 90 days rule)',
        attemptNumber: 0,
      }),
    });
    expect(initiateCallMock).toHaveBeenCalledTimes(1);
    expect(initiateCallMock.mock.calls[0][0]).toMatchObject({ claimId: 'claim-2' });
  });

  it('completes an APPROVED_PENDING_PAYMENT head entry and dispatches the next eligible claim', async () => {
    const approved = queueEntry('1', { status: 'APPROVED_PENDING_PAYMENT' });
    const eligible = queueEntry('2');
    const prisma = tickPrisma([approved, eligible]);

    validateDispatchMock
      .mockResolvedValueOnce({ allowed: false, code: 'APPROVED_PENDING_PAYMENT', reason: 'practice AR' })
      .mockResolvedValueOnce({ allowed: true });

    await runDeskQueueTick(prisma as unknown as PrismaClient);

    expect(prisma.callQueue.update).toHaveBeenCalledWith({
      where: { id: 'q-1' },
      data: { status: 'COMPLETED' },
    });
    expect(initiateCallMock).toHaveBeenCalledTimes(1);
    expect(initiateCallMock.mock.calls[0][0]).toMatchObject({ claimId: 'claim-2' });
  });

  it('defers a head claim whose PHI token expired and dispatches the next eligible claim', async () => {
    const expired = queueEntry('1');
    const eligible = queueEntry('2');
    const prisma = tickPrisma([expired, eligible]);

    validateDispatchMock.mockResolvedValue({ allowed: true });
    detokenizeMock
      .mockReturnValueOnce({ success: false, error: 'token expired' })
      .mockReturnValueOnce(phiSuccess());

    await runDeskQueueTick(prisma as unknown as PrismaClient);

    const deferCall = prisma.callQueue.update.mock.calls.find(
      ([args]: [{ where: { id: string }; data: Record<string, unknown> }]) =>
        args.where.id === 'q-1' && args.data.scheduledFor instanceof Date,
    );
    if (!deferCall) throw new Error('expected queue entry q-1 to be deferred');
    const deferredTo = (deferCall[0].data.scheduledFor as Date).getTime();
    expect(deferredTo).toBeGreaterThan(Date.now());
    expect(initiateCallMock).toHaveBeenCalledTimes(1);
    expect(initiateCallMock.mock.calls[0][0]).toMatchObject({ claimId: 'claim-2' });
  });

  it('defers a too-young head claim by roughly a day and continues', async () => {
    const young = queueEntry('1', { daysOutstanding: 20 });
    const eligible = queueEntry('2');
    const prisma = tickPrisma([young, eligible]);

    validateDispatchMock
      .mockResolvedValueOnce({ allowed: false, code: 'CLAIM_TOO_YOUNG', reason: 'min 30 days required' })
      .mockResolvedValueOnce({ allowed: true });

    await runDeskQueueTick(prisma as unknown as PrismaClient);

    const deferCall = prisma.callQueue.update.mock.calls.find(
      ([args]: [{ where: { id: string }; data: Record<string, unknown> }]) =>
        args.where.id === 'q-1' && args.data.scheduledFor instanceof Date,
    );
    if (!deferCall) throw new Error('expected queue entry q-1 to be deferred');
    const deferredTo = (deferCall[0].data.scheduledFor as Date).getTime();
    expect(deferredTo).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
    expect(initiateCallMock).toHaveBeenCalledTimes(1);
  });

  it('stops the whole practice on a practice-wide rejection without touching later candidates', async () => {
    const capped = queueEntry('1');
    const untouched = queueEntry('2');
    const prisma = tickPrisma([capped, untouched]);

    validateDispatchMock.mockResolvedValueOnce({
      allowed: false,
      code: 'SUBSCRIPTION_CLAIM_LIMIT_REACHED',
      reason: 'monthly claim limit reached',
    });

    await runDeskQueueTick(prisma as unknown as PrismaClient);

    expect(validateDispatchMock).toHaveBeenCalledTimes(1);
    expect(prisma.callQueue.update).not.toHaveBeenCalled();
    expect(initiateCallMock).not.toHaveBeenCalled();
  });

  it('continues past a triage-closed claim and dispatches the next eligible claim in the same tick', async () => {
    const triaged = queueEntry('1');
    const eligible = queueEntry('2');
    const prisma = tickPrisma([triaged, eligible]);

    validateDispatchMock.mockResolvedValue({ allowed: true });
    probeClaimStatusMock
      .mockResolvedValueOnce({ channel: 'pms_sync', detail: 'paid per PMS ledger' })
      .mockResolvedValueOnce(null);

    await runDeskQueueTick(prisma as unknown as PrismaClient);

    expect(transitionClaimRecoveryMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        practiceId: 'p1',
        claimId: 'claim-1',
        kind: 'TRIAGE_RESOLVED',
        triageChannel: 'pms_sync',
      }),
    );
    expect(initiateCallMock).toHaveBeenCalledTimes(1);
    expect(initiateCallMock.mock.calls[0][0]).toMatchObject({ claimId: 'claim-2' });
  });

  it('raises a practice-facing gate when patient data is incomplete, then defers and continues', async () => {
    const incomplete = queueEntry('1');
    const eligible = queueEntry('2');
    const prisma = tickPrisma([incomplete, eligible]);

    validateDispatchMock.mockResolvedValue({ allowed: true });
    completenessMock
      .mockReturnValueOnce({ ok: false, missing: ['subscriberId'], warnings: [] })
      .mockReturnValueOnce({ ok: true, missing: [], warnings: [] });

    await runDeskQueueTick(prisma as unknown as PrismaClient);

    expect(raiseGateMock).toHaveBeenCalledTimes(1);
    expect(raiseGateMock.mock.calls[0][1]).toMatchObject({
      practiceId: 'p1',
      claimId: 'claim-1',
      claimNumber: 'CN-1',
      outstandingAmount: 250,
      missing: ['subscriberId'],
    });
    const deferCall = prisma.callQueue.update.mock.calls.find(
      ([args]: [{ where: { id: string }; data: Record<string, unknown> }]) =>
        args.where.id === 'q-1' && args.data.scheduledFor instanceof Date,
    );
    if (!deferCall) throw new Error('expected queue entry q-1 to be deferred');
    expect(initiateCallMock).toHaveBeenCalledTimes(1);
    expect(initiateCallMock.mock.calls[0][0]).toMatchObject({ claimId: 'claim-2' });
  });

  it('dispatches at most one call per practice per tick', async () => {
    const first = queueEntry('1');
    const second = queueEntry('2');
    const prisma = tickPrisma([first, second]);

    validateDispatchMock.mockResolvedValue({ allowed: true });

    await runDeskQueueTick(prisma as unknown as PrismaClient);

    expect(initiateCallMock).toHaveBeenCalledTimes(1);
    expect(initiateCallMock.mock.calls[0][0]).toMatchObject({ claimId: 'claim-1' });
  });
});

describe('runDeskQueueTick resilience', () => {
  it('closes a stale call attempt whose webhook never arrived and releases its claim', async () => {
    const eligible = queueEntry('1');
    const prisma = tickPrisma([eligible]);
    prisma.callAttempt.findMany.mockResolvedValue([
      {
        id: 'attempt-stale',
        claimId: 'claim-old',
        vapiCallId: 'vapi-old',
        initiatedAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
      },
    ]);

    validateDispatchMock.mockResolvedValue({ allowed: true });

    await runDeskQueueTick(prisma as unknown as PrismaClient);

    expect(prisma.callAttempt.update).toHaveBeenCalledWith({
      where: { id: 'attempt-stale' },
      data: expect.objectContaining({ liveState: 'expired_no_webhook' }),
    });
    expect(prisma.callQueue.updateMany).toHaveBeenCalledWith({
      where: { claimId: 'claim-old', status: 'IN_PROGRESS' },
      data: expect.objectContaining({ status: 'PENDING' }),
    });
    expect(prisma.insuranceClaim.updateMany).toHaveBeenCalledWith({
      where: { id: 'claim-old', status: 'CALLING' },
      data: { status: 'IN_QUEUE' },
    });
  });

  it('still respects a fresh open call attempt (one call per practice)', async () => {
    const eligible = queueEntry('1');
    const prisma = tickPrisma([eligible]);
    prisma.callAttempt.findFirst.mockResolvedValue({
      id: 'attempt-live',
      initiatedAt: new Date(Date.now() - 10 * 60 * 1000),
    });

    await runDeskQueueTick(prisma as unknown as PrismaClient);

    expect(initiateCallMock).not.toHaveBeenCalled();
    expect(prisma.callAttempt.update).not.toHaveBeenCalled();
  });

  it('defers a claim whose Vapi dispatch throws and tries the next candidate', async () => {
    const failing = queueEntry('1');
    const eligible = queueEntry('2');
    const prisma = tickPrisma([failing, eligible]);

    validateDispatchMock.mockResolvedValue({ allowed: true });
    initiateCallMock
      .mockRejectedValueOnce(new Error('Vapi 500'))
      .mockResolvedValueOnce({ vapiCallId: 'vapi-2' });

    await runDeskQueueTick(prisma as unknown as PrismaClient);

    const deferCall = prisma.callQueue.update.mock.calls.find(
      ([args]: [{ where: { id: string }; data: Record<string, unknown> }]) =>
        args.where.id === 'q-1' && args.data.scheduledFor instanceof Date,
    );
    if (!deferCall) throw new Error('expected queue entry q-1 to be deferred');
    expect(initiateCallMock).toHaveBeenCalledTimes(2);
    expect(initiateCallMock.mock.calls[1][0]).toMatchObject({ claimId: 'claim-2' });
  });

  it('continues to the next practice when one practice tick throws', async () => {
    const eligible = queueEntry('1');
    const prisma = tickPrisma([eligible]);
    prisma.$queryRaw.mockResolvedValue([{ id: 'p-bad' }, { id: 'p1' }]);
    prisma.practiceDeskState.findUnique
      .mockRejectedValueOnce(new Error('db hiccup for p-bad'))
      .mockResolvedValueOnce(null);

    validateDispatchMock.mockResolvedValue({ allowed: true });

    await runDeskQueueTick(prisma as unknown as PrismaClient);

    expect(initiateCallMock).toHaveBeenCalledTimes(1);
    expect(initiateCallMock.mock.calls[0][0]).toMatchObject({ claimId: 'claim-1' });
  });
});
