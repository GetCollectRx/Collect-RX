/**
 * P0.5 — desk queue tick error recovery (non-BullMQ).
 *
 * runDeskQueueTick() is invoked by a plain setInterval loop in
 * startDeskQueueEngine(); before this pass a thrown tick was only logged and
 * the next fixed 60s fire would try again forever with no backoff and no
 * alert. This proves: consecutive failures back off (capped exponential),
 * a successful tick clears the failure count and records lastSuccessfulTickAt,
 * and 3 consecutive failures dispatches the desk_queue_tick_failing alert.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

function mockCommonDeps() {
  vi.doMock('../../src/carriers/adapter.js', () => ({
    validateDispatch: vi.fn(),
    CARRIER_CONFIGS: {},
    isWithinCallWindow: () => true,
  }));
  vi.doMock('../../src/vapi/client.js', () => ({ initiateCall: vi.fn(), endVapiCall: vi.fn() }));
  vi.doMock('../../src/vapi/circuitBreaker.js', () => ({
    vapiCircuitBreaker: { getState: () => 'CLOSED', getMetrics: () => ({ state: 'CLOSED' }) },
  }));
  vi.doMock('../../src/server/frontDesk/deskQueueBroadcast.js', () => ({ refreshDeskQueueBroadcast: vi.fn() }));
  vi.doMock('../../src/server/frontDesk/deskWs.js', () => ({ broadcastDesk: vi.fn() }));
  vi.doMock('../../src/server/frontDesk/deskMappers.js', () => ({ mapActiveCall: vi.fn() }));
  vi.doMock('../../src/server/plans/planBridge.js', () => ({ canMakeCall: vi.fn() }));
  vi.doMock('../../src/billing/tiers.js', () => ({ CALL_TIMEOUTS: {}, CARRIER_TIMEOUTS: {} }));
  vi.doMock('../../src/server/services/practiceSettingsService.js', () => ({ getPracticeSettings: vi.fn() }));
  vi.doMock('../../src/pii-vault.js', () => ({ piiVault: {} }));
  vi.doMock('../../src/server/frontDesk/patientDataCompleteness.js', () => ({
    checkPatientDataCompleteness: vi.fn(),
    raiseMissingPatientDataGate: vi.fn(),
  }));
  vi.doMock('../../src/server/triage/claimStatusProbe.js', () => ({ probeClaimStatus: vi.fn() }));
  vi.doMock('../../src/server/recovery/transitionClaimRecovery.js', () => ({ transitionClaimRecovery: vi.fn() }));
  vi.doMock('../../src/server/learning/carrierLessons.js', () => ({ getApprovedNavigationNotes: vi.fn() }));
  vi.doMock('../../src/server/discovery/carrierDiscoveryService.js', () => ({ getPublishedNavigationSteps: vi.fn() }));
  vi.doMock('../../src/server/db/rlsContext.js', () => ({
    runWithPracticeRls: (_id: string, fn: () => unknown) => fn(),
    runWithRlsBypass: (fn: () => unknown) => fn(),
  }));
  vi.doMock('../../src/server/services/escalationService.js', () => ({ createEscalation: vi.fn() }));
  vi.doMock('../../src/server/audit/auditLog.js', () => ({ appendPhiAccessEvent: vi.fn() }));
  vi.doMock('../../src/server/observability/logger.js', () => ({
    default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), audit: vi.fn() },
  }));
}

describe('desk queue engine — tick failure recovery', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('backs off after a failure instead of retrying on the very next 60s fire', async () => {
    mockCommonDeps();
    const dispatchOpsAlert = vi.fn().mockResolvedValue({ sent: false, channels: [], skippedCooldown: false });
    vi.doMock('../../src/server/observability/opsAlerts.js', () => ({ dispatchOpsAlert }));

    let shouldFail = true;
    const prisma = {
      $executeRaw: vi.fn(async () => {
        if (shouldFail) throw new Error('DB unreachable');
        return 1;
      }),
      $queryRaw: vi.fn(async () => []),
      callAttempt: { count: async () => 0, findMany: async () => [] },
    } as unknown as PrismaClient;

    const { startDeskQueueEngine, stopDeskQueueEngine, getDeskQueueTickHealth } = await import(
      '../../src/server/frontDesk/queueEngine.js'
    );

    startDeskQueueEngine(prisma); // fires immediately — will fail
    await vi.advanceTimersByTimeAsync(0);

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(getDeskQueueTickHealth().consecutiveTickFailures).toBe(1);

    // Backoff after 1 failure is 120s (2x the tick interval) — the very next
    // scheduled 60s fire must be skipped, not retried immediately.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(getDeskQueueTickHealth().consecutiveTickFailures).toBe(1);

    // By +120s total the backoff has elapsed and the tick retries.
    shouldFail = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(getDeskQueueTickHealth().consecutiveTickFailures).toBe(0);
    expect(getDeskQueueTickHealth().lastSuccessfulTickAt).not.toBeNull();

    stopDeskQueueEngine();
  });

  it('dispatches the desk_queue_tick_failing alert once 3 consecutive failures accumulate', async () => {
    mockCommonDeps();
    const dispatchOpsAlert = vi.fn().mockResolvedValue({ sent: false, channels: [], skippedCooldown: false });
    vi.doMock('../../src/server/observability/opsAlerts.js', () => ({ dispatchOpsAlert }));

    const prisma = {
      $executeRaw: vi.fn(async () => {
        throw new Error('DB unreachable');
      }),
      $queryRaw: vi.fn(async () => []),
      callAttempt: { count: async () => 0, findMany: async () => [] },
    } as unknown as PrismaClient;

    const { startDeskQueueEngine, stopDeskQueueEngine, getDeskQueueTickHealth } = await import(
      '../../src/server/frontDesk/queueEngine.js'
    );

    startDeskQueueEngine(prisma); // failure 1 — backoff 120s (2^1 * 60s)
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatchOpsAlert).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(120_000); // failure 2 — backoff 240s (2^2 * 60s)
    expect(dispatchOpsAlert).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(240_000); // failure 3 — alert threshold reached
    expect(dispatchOpsAlert).toHaveBeenCalledTimes(1);
    expect(dispatchOpsAlert.mock.calls[0][0]).toMatchObject({
      alertId: 'desk_queue_tick_failing',
      source: 'desk-queue-engine',
    });
    expect(getDeskQueueTickHealth().consecutiveTickFailures).toBe(3);

    stopDeskQueueEngine();
  });
});
