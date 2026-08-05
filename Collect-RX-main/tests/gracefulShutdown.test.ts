/**
 * Graceful-shutdown hooks added for the unsupervised-pilot safety pass:
 * - drainDeskQueueEngine() must not let a hard exit abandon an in-flight
 *   dispatch tick mid-claim, but must still give up after its timeout so
 *   shutdown can't hang forever on a stuck tick.
 * - closeAllDeskConnections() must send every connected client a real 1001
 *   close frame (not an abrupt reset) and refuse new connections afterward.
 *
 * Unit-level: no DB, no real WebSocket server. The queue-engine tests drive
 * the real runDeskQueueTick() through startDeskQueueEngine()'s public
 * surface, gating it at claimTickLease()'s prisma.$executeRaw call — the
 * first thing the real tick body awaits once past the call-window check —
 * so drainDeskQueueEngine is exercised against genuinely in-flight work,
 * not a mock of itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const mockModules = () => {
  vi.doMock('../src/carriers/adapter.js', () => ({
    validateDispatch: vi.fn(),
    CARRIER_CONFIGS: {},
    isWithinCallWindow: () => true,
  }));
  vi.doMock('../src/vapi/client.js', () => ({ initiateCall: vi.fn(), endVapiCall: vi.fn() }));
  vi.doMock('../src/server/frontDesk/deskQueueBroadcast.js', () => ({ refreshDeskQueueBroadcast: vi.fn() }));
  vi.doMock('../src/server/frontDesk/deskWs.js', () => ({ broadcastDesk: vi.fn() }));
  vi.doMock('../src/server/frontDesk/deskMappers.js', () => ({ mapActiveCall: vi.fn() }));
  vi.doMock('../src/server/plans/planBridge.js', () => ({ canMakeCall: vi.fn() }));
  vi.doMock('../src/billing/tiers.js', () => ({ CALL_TIMEOUTS: {} }));
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
  vi.doMock('../src/server/observability/logger.js', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
};

describe('drainDeskQueueEngine', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    // Belt-and-suspenders: make sure no leftover interval survives into the
    // next test file even if a test fails before reaching drain.
    const mod = await import('../src/server/frontDesk/queueEngine.js');
    mod.stopDeskQueueEngine();
  });

  it('resolves immediately when no tick is in flight', async () => {
    mockModules();
    const mod = await import('../src/server/frontDesk/queueEngine.js');
    const start = Date.now();
    await mod.drainDeskQueueEngine(5_000);
    expect(Date.now() - start).toBeLessThan(200);
  });

  it('waits for an in-flight tick to finish before resolving', async () => {
    mockModules();
    let releaseTick!: () => void;
    const tickGate = new Promise<void>((resolve) => {
      releaseTick = resolve;
    });
    const prisma = {
      $executeRaw: () => tickGate.then(() => 0),
    } as unknown as PrismaClient;

    const mod = await import('../src/server/frontDesk/queueEngine.js');
    mod.startDeskQueueEngine(prisma);

    // Let the immediate first tick actually start and reach the gated call.
    await new Promise((r) => setTimeout(r, 10));

    let drained = false;
    const drainPromise = mod.drainDeskQueueEngine(5_000).then(() => {
      drained = true;
    });

    // Must not resolve while the tick is still gated open.
    await new Promise((r) => setTimeout(r, 30));
    expect(drained).toBe(false);

    releaseTick();
    await drainPromise;
    expect(drained).toBe(true);
  });

  it('stops scheduling new ticks once draining starts', async () => {
    mockModules();
    let calls = 0;
    const prisma = {
      $executeRaw: () => {
        calls += 1;
        return Promise.resolve(0);
      },
    } as unknown as PrismaClient;

    const mod = await import('../src/server/frontDesk/queueEngine.js');
    mod.startDeskQueueEngine(prisma);
    await new Promise((r) => setTimeout(r, 10));

    await mod.drainDeskQueueEngine(5_000);
    const callsAtDrain = calls;

    // Even if something still fired the interval, drainDeskQueueEngine
    // already cleared it — no further ticks should land.
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(callsAtDrain);
  });

  it('gives up after its timeout if the tick never finishes, without throwing', async () => {
    mockModules();
    const neverResolves = new Promise<number>(() => {
      /* simulates a hung tick — must never resolve for this test */
    });
    const prisma = {
      $executeRaw: () => neverResolves,
    } as unknown as PrismaClient;

    const mod = await import('../src/server/frontDesk/queueEngine.js');
    mod.startDeskQueueEngine(prisma);
    await new Promise((r) => setTimeout(r, 10));

    const start = Date.now();
    await expect(mod.drainDeskQueueEngine(100)).resolves.toBeUndefined();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(elapsed).toBeLessThan(1000);
  });
});

// closeAllDeskConnections() is covered in tests/deskWsShutdown.test.ts —
// kept in a separate file because this file's tick tests mock deskWs.js
// wholesale, and vi.doMock registrations survive vi.resetModules().
