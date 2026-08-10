/**
 * A queue entry must be claimed atomically before the call is placed.
 *
 * Production runs more than one app machine, and the tick latch that prevents
 * overlapping ticks (`isTickRunning`) is a module-level boolean — it is per
 * process and says nothing about what another machine is doing. Dispatch used
 * to read PENDING candidates, place the Vapi call, and only then mark the row
 * IN_PROGRESS, so two machines ticking within the same window could both read
 * the same PENDING row and both dial the carrier about the same claim. Two
 * simultaneous calls about one claim is exactly the behaviour carrier IVR
 * security reads as automation.
 *
 * Claiming the row first also means an attempt is counted even if the process
 * dies mid-dial, so the max-3 ceiling cannot be reset by a crash loop.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const validateDispatchMock = vi.fn();
const initiateCallMock = vi.fn();
const detokenizeMock = vi.fn();
const probeClaimStatusMock = vi.fn();
const canMakeCallMock = vi.fn();
const completenessMock = vi.fn();

vi.mock('../../src/carriers/adapter.js', () => ({
  validateDispatch: (...args: unknown[]) => validateDispatchMock(...args),
  isWithinCallWindow: () => true,
  CARRIER_CONFIGS: {
    sun_life: { carrierId: 'sun_life', displayName: 'Sun Life', phone: '+18005550100', ivrHints: [] },
  },
}));
vi.mock('../../src/vapi/client.js', () => ({
  initiateCall: (...args: unknown[]) => initiateCallMock(...args),
  endVapiCall: vi.fn(),
}));
vi.mock('../../src/server/frontDesk/deskQueueBroadcast.js', () => ({
  refreshDeskQueueBroadcast: vi.fn(),
}));
vi.mock('../../src/server/frontDesk/deskWs.js', () => ({ broadcastDesk: vi.fn() }));
vi.mock('../../src/server/frontDesk/deskMappers.js', () => ({ mapActiveCall: vi.fn(() => ({})) }));
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
  raiseMissingPatientDataGate: vi.fn(),
}));
vi.mock('../../src/server/triage/claimStatusProbe.js', () => ({
  probeClaimStatus: (...args: unknown[]) => probeClaimStatusMock(...args),
}));
vi.mock('../../src/server/recovery/transitionClaimRecovery.js', () => ({
  transitionClaimRecovery: vi.fn(),
}));
vi.mock('../../src/server/learning/carrierLessons.js', () => ({
  getApprovedNavigationNotes: vi.fn(async () => ''),
}));
vi.mock('../../src/server/discovery/carrierDiscoveryService.js', () => ({
  getPublishedNavigationSteps: vi.fn(async () => []),
}));
vi.mock('../../src/server/db/rlsContext.js', () => ({
  runWithPracticeRls: (_p: string, fn: () => Promise<unknown>) => fn(),
  runWithRlsBypass: (fn: () => Promise<unknown>) => fn(),
}));
vi.mock('../../src/server/services/escalationService.js', () => ({ createEscalation: vi.fn() }));
vi.mock('../../src/server/audit/auditLog.js', () => ({ appendPhiAccessEvent: vi.fn() }));
vi.mock('../../src/logger.cjs', () => ({
  default: { warn: vi.fn(), error: vi.fn(), audit: vi.fn() },
}));

import { runDeskQueueTick } from '../../src/server/frontDesk/queueEngine.js';

function candidate() {
  return {
    id: 'q-1',
    practiceId: 'p1',
    claimId: 'claim-1',
    attempts: 0,
    scheduledFor: new Date(Date.now() - 60_000),
    claim: {
      id: 'claim-1',
      carrierId: 'sun_life',
      claimNumber: 'CN-1',
      billedAmount: 250,
      outstandingAmount: 250,
      expectedAmount: null,
      daysOutstanding: 45,
      servicedAt: null,
      submittedAt: null,
      treatmentCodes: null,
      patientToken: 'tok-1',
      status: 'IN_QUEUE',
    },
  };
}

/**
 * @param claimWins whether this process's atomic claim of the row succeeds —
 * false models another machine having taken the row a moment earlier.
 * @param otherInProgress rows the practice already has in flight, modelling
 * another machine having claimed a different claim in the same instant.
 */
function dispatchPrisma(claimWins: boolean, otherInProgress = 0) {
  return {
    practice: {
      findMany: vi.fn(async () => [{ id: 'p1' }]),
      findUnique: vi.fn(async () => ({
        name: 'Fixture Practice',
        billingPhone: '416-555-0100',
        npi: null,
        taxId: null,
        practiceAddress: null,
      })),
    },
    practiceDeskState: { findUnique: vi.fn(async () => null) },
    organizationPractice: { findMany: vi.fn(async () => []) },
    carrierBlockEvent: { findMany: vi.fn(async () => []) },
    callQueue: {
      // First call is the practice's own in-progress gate (0 = free to
      // dispatch); the post-claim call reports what another machine holds.
      count: vi
        .fn()
        .mockResolvedValueOnce(0)
        .mockResolvedValue(otherInProgress),
      findMany: vi.fn(async () => [candidate()]),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: claimWins ? 1 : 0 })),
    },
    callAttempt: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'attempt-1' })),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    insuranceClaim: { update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 0 })) },
    callEscalation: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({})) },
    claimRecoveryEvent: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (ops: unknown) => {
      if (Array.isArray(ops)) return Promise.all(ops);
      return (ops as (tx: unknown) => Promise<unknown>)({});
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  canMakeCallMock.mockResolvedValue({ allowed: true });
  probeClaimStatusMock.mockResolvedValue(null);
  detokenizeMock.mockReturnValue({
    success: true,
    phi: {
      patientName: 'Test Patient',
      dateOfBirth: '1990-01-01',
      subscriberId: 'SUB-1',
      groupPolicyNumber: 'GRP-1',
      subscriberName: 'Test Patient',
      subscriberDateOfBirth: '1990-01-01',
    },
  });
  initiateCallMock.mockResolvedValue({ vapiCallId: 'vapi-1' });
  completenessMock.mockReturnValue({ ok: true, missing: [], warnings: [] });
  validateDispatchMock.mockResolvedValue({ allowed: true });
  process.env.VAPI_MAX_CONCURRENT_CALLS = '10';
  process.env.VAPI_CONCURRENCY_RESERVE = '2';
});

describe('queue entry claim before dispatch', () => {
  it('claims the queue row before placing the call', async () => {
    const prisma = dispatchPrisma(true);

    await runDeskQueueTick(prisma as never);

    expect(initiateCallMock).toHaveBeenCalledTimes(1);
    // The claim must be recorded before the carrier is dialled, not after.
    const claimOrder = prisma.callQueue.updateMany.mock.invocationCallOrder[0];
    const dialOrder = initiateCallMock.mock.invocationCallOrder[0];
    expect(claimOrder).toBeLessThan(dialOrder);
  });

  it('marks the row IN_PROGRESS and counts the attempt as it claims', async () => {
    const prisma = dispatchPrisma(true);

    await runDeskQueueTick(prisma as never);

    const claim = prisma.callQueue.updateMany.mock.calls[0]?.[0] as {
      where: { status: string };
      data: { status: string; attempts: { increment: number } };
    };
    // Filtering on PENDING is what makes the claim atomic across processes.
    expect(claim.where.status).toBe('PENDING');
    expect(claim.data.status).toBe('IN_PROGRESS');
    expect(claim.data.attempts).toEqual({ increment: 1 });
  });

  it('does not dial when another process already claimed the row', async () => {
    const prisma = dispatchPrisma(false);

    await runDeskQueueTick(prisma as never);

    expect(initiateCallMock).not.toHaveBeenCalled();
  });

  it('releases its claim and does not dial when it loses the practice race', async () => {
    // Claim succeeded, but another machine already has a call in flight for
    // this practice — dialling would break the one-call-per-practice rule.
    const prisma = dispatchPrisma(true, 1);

    await runDeskQueueTick(prisma as never);

    expect(initiateCallMock).not.toHaveBeenCalled();
    const release = prisma.callQueue.update.mock.calls[0]?.[0] as {
      data: { status: string; dispatchDeferralCode: string };
    };
    expect(release.data.status).toBe('PENDING');
    expect(release.data.dispatchDeferralCode).toBe('PRACTICE_CALL_IN_PROGRESS');
  });
});
