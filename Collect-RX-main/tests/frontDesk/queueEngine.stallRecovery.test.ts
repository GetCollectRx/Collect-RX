/**
 * Stale-attempt recovery must not depend on there being a free calling slot.
 *
 * Open CallAttempt rows are what the fleet-wide Vapi slot budget counts, and a
 * lost end-of-call webhook leaves one open forever. If the budget check runs
 * before the watchdog that closes those rows, enough lost webhooks exhaust the
 * budget, the tick returns early, the watchdog never runs, and dispatch is
 * frozen for every practice until someone restarts the process — the abandoned
 * rows are simultaneously the cause of the exhaustion and the thing the skipped
 * code path would have cleaned up.
 *
 * The same applies to a paused practice: pausing must stop dispatch, not stop
 * that practice's stale attempts from ever being reaped.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const validateDispatchMock = vi.fn();
const initiateCallMock = vi.fn();
const detokenizeMock = vi.fn();
const probeClaimStatusMock = vi.fn();
const canMakeCallMock = vi.fn();
const completenessMock = vi.fn();
const endVapiCallMock = vi.fn();

vi.mock('../../src/carriers/adapter.js', () => ({
  validateDispatch: (...args: unknown[]) => validateDispatchMock(...args),
  isWithinCallWindow: () => true,
  CARRIER_CONFIGS: {
    sun_life: {
      carrierId: 'sun_life',
      displayName: 'Sun Life Financial',
      phone: '+18005550100',
      ivrHints: [],
    },
  },
}));

vi.mock('../../src/vapi/client.js', () => ({
  initiateCall: (...args: unknown[]) => initiateCallMock(...args),
  endVapiCall: (...args: unknown[]) => endVapiCallMock(...args),
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

const HOURS_4_AGO = new Date(Date.now() - 4 * 60 * 60 * 1000);

/**
 * Prisma stub whose open-attempt count reflects rows the watchdog has not yet
 * closed, so exhaustion and recovery interact the way they do in production.
 */
function stallPrisma(opts: { paused?: boolean; staleCount: number }) {
  const staleAttempts = Array.from({ length: opts.staleCount }, (_, i) => ({
    id: `attempt-${i}`,
    claimId: `claim-${i}`,
    vapiCallId: `vapi-${i}`,
    initiatedAt: HOURS_4_AGO,
  }));
  const closed = new Set<string>();

  const openCount = () => staleAttempts.filter((a) => !closed.has(a.id)).length;

  const prisma = {
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
    practiceDeskState: {
      findUnique: vi.fn(async () => ({ practiceId: 'p1', queuePaused: opts.paused ?? false })),
    },
    organizationPractice: { findMany: vi.fn(async () => []) },
    carrierBlockEvent: { findMany: vi.fn(async () => []) },
    callQueue: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    callAttempt: {
      count: vi.fn(async () => openCount()),
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => {
        const open = staleAttempts.filter((a) => !closed.has(a.id));
        // The over-ceiling terminator and the stale watchdog both query open
        // attempts by age; this stub is old enough to satisfy either.
        if (where && 'initiatedAt' in where) return open;
        return open.map((a) => ({ claim: { carrierId: 'sun_life' } }));
      }),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'new-attempt' })),
      update: vi.fn(async ({ where }: { where: { id: string } }) => {
        closed.add(where.id);
        return {};
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    insuranceClaim: { update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 0 })) },
    callEscalation: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({})) },
    claimRecoveryEvent: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (ops: unknown) => {
      if (Array.isArray(ops)) return Promise.all(ops);
      return (ops as (tx: unknown) => Promise<unknown>)(prisma);
    }),
  };
  return { prisma, closed, openCount };
}

beforeEach(() => {
  vi.clearAllMocks();
  canMakeCallMock.mockResolvedValue({ allowed: true });
  probeClaimStatusMock.mockResolvedValue(null);
  detokenizeMock.mockReturnValue({ success: true, phi: {} });
  initiateCallMock.mockResolvedValue({ vapiCallId: 'vapi-new' });
  completenessMock.mockReturnValue({ ok: true, missing: [], warnings: [] });
  validateDispatchMock.mockResolvedValue({ allowed: true });
  process.env.VAPI_MAX_CONCURRENT_CALLS = '10';
  process.env.VAPI_CONCURRENCY_RESERVE = '2';
});

describe('queue engine stall recovery', () => {
  it('reaps stale attempts even when they have exhausted the fleet slot budget', async () => {
    // 8 abandoned attempts == the entire budget (10 limit - 2 reserve).
    const { prisma, closed } = stallPrisma({ staleCount: 8 });

    await runDeskQueueTick(prisma as never);

    expect(closed.size).toBe(8);
  });

  it('recovers dispatch capacity on the tick after the stale attempts are reaped', async () => {
    const { prisma, openCount } = stallPrisma({ staleCount: 8 });

    await runDeskQueueTick(prisma as never);
    expect(openCount()).toBe(0);

    // Second tick: budget is free again because the watchdog ran.
    await runDeskQueueTick(prisma as never);
    expect(prisma.callAttempt.count).toHaveBeenCalled();
  });

  it('reaps stale attempts for a paused practice without dispatching', async () => {
    const { prisma, closed } = stallPrisma({ paused: true, staleCount: 3 });

    await runDeskQueueTick(prisma as never);

    expect(closed.size).toBe(3);
    expect(initiateCallMock).not.toHaveBeenCalled();
  });
});
