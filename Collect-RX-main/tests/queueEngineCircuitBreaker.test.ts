/**
 * P0.2 acceptance criterion: "When circuit is OPEN, runDeskQueueTick() skips
 * Vapi dispatch and logs structured deferral reason" — and does not hang.
 * Proves this against the real runDeskQueueTick(), not a reimplementation:
 * a practice IS due for dispatch (so there's real work the tick could do),
 * but with the breaker forced OPEN, initiateCall must never be reached.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

function mockCommonDeps() {
  vi.doMock('../src/carriers/adapter.js', () => ({
    validateDispatch: vi.fn(),
    CARRIER_CONFIGS: {},
    isWithinCallWindow: () => true,
  }));
  vi.doMock('../src/server/frontDesk/deskQueueBroadcast.js', () => ({ refreshDeskQueueBroadcast: vi.fn() }));
  vi.doMock('../src/server/frontDesk/deskWs.js', () => ({ broadcastDesk: vi.fn() }));
  vi.doMock('../src/server/frontDesk/deskMappers.js', () => ({ mapActiveCall: vi.fn() }));
  vi.doMock('../src/server/plans/planBridge.js', () => ({ canMakeCall: vi.fn() }));
  vi.doMock('../src/billing/tiers.js', () => ({ CALL_TIMEOUTS: {}, CARRIER_TIMEOUTS: {} }));
  vi.doMock('../src/server/services/practiceSettingsService.js', () => ({ getPracticeSettings: vi.fn() }));
  vi.doMock('../src/pii-vault.js', () => ({ piiVault: {} }));
  vi.doMock('../src/server/frontDesk/patientDataCompleteness.js', () => ({
    checkPatientDataCompleteness: vi.fn(),
    raiseMissingPatientDataGate: vi.fn(),
  }));
  vi.doMock('../src/server/triage/claimStatusProbe.js', () => ({ probeClaimStatus: vi.fn() }));
  vi.doMock('../src/server/recovery/transitionClaimRecovery.js', () => ({ transitionClaimRecovery: vi.fn() }));
  vi.doMock('../src/server/learning/carrierLessons.js', () => ({ getApprovedNavigationNotes: vi.fn() }));
  vi.doMock('../src/server/discovery/carrierDiscoveryService.js', () => ({ getPublishedNavigationSteps: vi.fn() }));
  vi.doMock('../src/server/db/rlsContext.js', () => ({
    runWithPracticeRls: (_id: string, fn: () => unknown) => fn(),
    runWithRlsBypass: (fn: () => unknown) => fn(),
  }));
  vi.doMock('../src/server/services/escalationService.js', () => ({ createEscalation: vi.fn() }));
  vi.doMock('../src/server/audit/auditLog.js', () => ({ appendPhiAccessEvent: vi.fn() }));
  vi.doMock('../src/server/observability/logger.js', () => ({
    default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  }));
}

describe('runDeskQueueTick — circuit breaker gate', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('skips dispatch entirely when the breaker is OPEN, even with a practice due, and resolves promptly (does not hang)', async () => {
    mockCommonDeps();
    const initiateCall = vi.fn();
    vi.doMock('../src/vapi/client.js', () => ({ initiateCall, endVapiCall: vi.fn() }));
    vi.doMock('../src/vapi/circuitBreaker.js', () => ({
      vapiCircuitBreaker: {
        getState: () => 'OPEN',
        getMetrics: () => ({ state: 'OPEN' }),
      },
    }));

    const loggerModule = await import('../src/server/observability/logger.js');
    const prisma = {
      $executeRaw: async () => 1, // claimTickLease succeeds
      $queryRaw: async () => [{ id: 'practice-1' }], // a practice IS due
      callAttempt: { count: async () => 0, findMany: async () => [] },
    } as unknown as PrismaClient;

    const { runDeskQueueTick } = await import('../src/server/frontDesk/queueEngine.js');

    const start = Date.now();
    await runDeskQueueTick(prisma);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(500); // proves it did not hang waiting on anything
    expect(initiateCall).not.toHaveBeenCalled();
    expect(loggerModule.default.warn).toHaveBeenCalledWith(
      expect.stringContaining('circuit breaker OPEN'),
      expect.any(Object),
    );
  });

  it('does not skip when the breaker is CLOSED (the new check is a no-op in the normal case)', async () => {
    mockCommonDeps();
    vi.doMock('../src/vapi/client.js', () => ({ initiateCall: vi.fn(), endVapiCall: vi.fn() }));
    vi.doMock('../src/vapi/circuitBreaker.js', () => ({
      vapiCircuitBreaker: {
        getState: () => 'CLOSED',
        getMetrics: () => ({ state: 'CLOSED' }),
      },
    }));

    const loggerModule = await import('../src/server/observability/logger.js');
    const prisma = {
      $executeRaw: async () => 1,
      $queryRaw: async () => [], // no practices due — nothing to dispatch either way
      callAttempt: { count: async () => 0, findMany: async () => [] },
    } as unknown as PrismaClient;

    const { runDeskQueueTick } = await import('../src/server/frontDesk/queueEngine.js');
    await runDeskQueueTick(prisma);

    const warnCalls = (loggerModule.default.warn as ReturnType<typeof vi.fn>).mock.calls;
    const circuitWarnCalls = warnCalls.filter((args) =>
      typeof args[0] === 'string' && args[0].includes('circuit breaker OPEN'),
    );
    expect(circuitWarnCalls).toHaveLength(0);
  });
});
