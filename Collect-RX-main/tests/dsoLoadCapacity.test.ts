/**
 * Real 20-practice dispatch load test — the gap in every other test file.
 *
 * Every other dispatch test either mocks Prisma entirely (fast, but proves
 * nothing about real DB/RLS/PHI-vault behavior under load) or exercises the
 * fairness/lease primitives in isolation (tests/queueEngineFairnessAndLease.test.ts).
 * This file runs the REAL runDeskQueueTick end-to-end — real Postgres, real
 * RLS context switching, real PHI vault tokenize/detokenize, real dispatch
 * validation, real DB writes — for 20 real practices at once. The only thing
 * mocked is the actual outbound network call to Vapi (src/vapi/client.js),
 * because placing real calls costs money and requires explicit authorization;
 * everything on this side of that boundary is real.
 *
 * VAPI_MAX_CONCURRENT_CALLS is set high enough that the slot budget is never
 * the constraint here — slot-budget-driven fairness under scarcity is already
 * proven directly in tests/queueEngineFairnessAndLease.test.ts. This file's
 * job is different: does the full real pipeline work correctly and perform
 * reasonably at N=20, with no artificial scarcity confounding the result.
 *
 * That budget must be set generously (not just "above 20"): vapiSlotBudget()
 * reads `prisma.callAttempt.count({ where: { completedAt: null } })`
 * GLOBALLY across the whole database, by design — it mirrors a real Vapi
 * account's fleet-wide concurrency limit, correctly unscoped to any one
 * practice. That means it also picks up open CallAttempt rows left behind by
 * *other* test files sharing this same Postgres instance. Confirmed directly:
 * a repeat run of the full suite left 12 stale open attempts in the shared
 * local DB from earlier sessions, which silently ate into a too-tight budget
 * here and caused a real (reproduced) flaky failure — 18/20 dispatched
 * instead of 20. Fixed by budgeting for ambient noise, not just this file's
 * own fleet size.
 *
 * DB-dependent; skipped with a clear log if DATABASE_URL is unreachable.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CarrierId } from '@prisma/client';

const initiateCallMock = vi.fn(async () => ({
  vapiCallId: `vapi-load-${randomUUID()}`,
  status: 'queued' as const,
  createdAt: new Date().toISOString(),
}));

vi.mock('../src/vapi/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/vapi/client.js')>();
  return {
    ...actual,
    initiateCall: (...args: unknown[]) => initiateCallMock(...(args as [unknown])),
    endVapiCall: vi.fn(async () => undefined),
  };
});

// The only other override needed is the Mon-Fri 8am-5pm ET gate, so this test
// is not flaky depending on when CI happens to run it. validateDispatch and
// CARRIER_CONFIGS stay real — this test's whole point is exercising the real
// dispatch guard chain, not bypassing it.
//
// This is NOT done by mocking carriers/adapter.js's isWithinCallWindow export.
// That was tried first and looked right, but validateDispatch() calls
// isWithinCallWindow() as a same-module local reference, not through the
// module's export object — vi.mock only rewrites what OTHER modules see when
// they import this one, so queueEngine.ts's top-level `isWithinCallWindow()`
// gate picked up the mock while validateDispatch's internal check kept
// calling the real, unmocked function. Confirmed directly: CI failed twice
// with initiateCallMock called 0 times, and both runs' logs showed real
// OUTSIDE_CALL_WINDOW rejections for every fleet claim ("current Eastern
// hour: 21") — proof the override never reached the check that mattered.
// Pinning the actual system clock (Date only — setTimeout/network stay real
// so DB/HTTP calls aren't affected) satisfies both call sites for real,
// because neither one is being intercepted; the underlying wall clock itself
// is just inside the window.
const BUSINESS_HOURS_ET = new Date('2024-01-09T15:00:00Z'); // Tue 10:00 EST — no DST ambiguity

process.env.VAPI_MAX_CONCURRENT_CALLS = '500';
process.env.VAPI_CONCURRENCY_RESERVE = '0';

const { prisma } = await import('../src/server/index.js');
const { runDeskQueueTick } = await import('../src/server/frontDesk/queueEngine.js');
const { createPracticeForTests } = await import('./factories/practice.js');
const { defaultPracticeSettings, updatePracticeSettings } = await import(
  '../src/server/services/practiceSettingsService.js'
);
const { piiVault } = await import('../src/pii-vault.js');
const { default: logger } = await import('../src/logger.cjs');

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn(
    '[dsoLoadCapacity] DATABASE_URL unreachable — DB-dependent tests will be skipped:',
    (e as Error).message,
  );
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

const FLEET_SIZE = 20;

interface FleetPractice {
  id: string;
  claimId: string;
}

async function seedDispatchablePractice(): Promise<FleetPractice> {
  const practice = await createPracticeForTests(prisma);

  const settings = defaultPracticeSettings();
  settings.voiceAgentEnabled = true;
  settings.carrierConfigs = settings.carrierConfigs.map((c) =>
    c.carrierId === 'sun_life'
      ? { ...c, authorizationSubmitted: true, providerNumber: `PN-LOAD-${practice.id.slice(0, 8)}` }
      : c,
  );
  await updatePracticeSettings(prisma, practice.id, settings);

  const patientToken = piiVault.tokenize(
    {
      patientName: 'Load Test Patient',
      dateOfBirth: '1985-06-15',
      subscriberId: `SUB-${practice.id.slice(0, 8)}`,
      groupPolicyNumber: `GRP-${practice.id.slice(0, 8)}`,
    },
    'dso_load_test',
    practice.id,
  );

  const claim = await prisma.insuranceClaim.create({
    data: {
      practiceId: practice.id,
      carrierId: 'sun_life' as CarrierId,
      claimNumber: `LOAD-${practice.id.slice(0, 8)}`,
      patientToken,
      billedAmount: 250,
      outstandingAmount: 250,
      daysOutstanding: 40,
      status: 'PENDING',
    },
  });

  await prisma.callQueue.create({
    data: {
      practiceId: practice.id,
      claimId: claim.id,
      scheduledFor: new Date(Date.now() - 1000),
      status: 'PENDING',
    },
  });

  return { id: practice.id, claimId: claim.id };
}

async function cleanupFleet(fleet: FleetPractice[]): Promise<void> {
  const practiceIds = fleet.map((p) => p.id);
  if (practiceIds.length === 0) return;
  await prisma.callAttempt.deleteMany({ where: { claim: { practiceId: { in: practiceIds } } } });
  await prisma.callQueue.deleteMany({ where: { practiceId: { in: practiceIds } } });
  await prisma.insuranceClaim.deleteMany({ where: { practiceId: { in: practiceIds } } });
  await prisma.practiceDeskState.deleteMany({ where: { practiceId: { in: practiceIds } } });
  await prisma.practice.deleteMany({ where: { id: { in: practiceIds } } });
}

describe.skipIf(!dbReady)('DSO load capacity: real dispatch pipeline at N=20', () => {
  let fleet: FleetPractice[] = [];

  beforeAll(async () => {
    if (!dbReady) return;
    // Only Date is faked — setTimeout/setInterval/network stay real, so the
    // real DB and Vapi-mock I/O below still runs on the actual clock. This
    // must be set before seeding: seedDispatchablePractice() below stamps
    // callQueue.scheduledFor from Date.now(), and it needs to land inside the
    // same pinned window the dispatch checks will later evaluate against.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(BUSINESS_HOURS_ET);

    // queue_engine_lease is a global singleton row (by design — one lease
    // for the whole fleet). A previous test process can leave it live for up
    // to LEASE_TTL_MS under ITS OWN instance ID; a fresh `vitest run` is a
    // new Node process with a different instance ID, so without this reset
    // it gets correctly-but-unhelpfully rejected by a lease it doesn't own,
    // for up to 90s after any prior run. Reproduced directly: back-to-back
    // invocations of this file failed every time until this reset was added.
    await prisma.queueEngineLease.deleteMany({ where: { id: 'global' } });
    fleet = await Promise.all(Array.from({ length: FLEET_SIZE }, () => seedDispatchablePractice()));
  }, 60_000);

  afterAll(async () => {
    await cleanupFleet(fleet);
    await prisma.queueEngineLease.deleteMany({ where: { id: 'global' } });
    vi.useRealTimers();
  });

  it('dispatches every practice through the real pipeline with no errors, in bounded wall-clock time', async () => {
    initiateCallMock.mockClear();

    // performance.now() rather than Date.now(): Date is pinned above, so
    // Date.now() would always read ~0ms elapsed and the bound below would
    // assert nothing.
    const start = performance.now();
    await runDeskQueueTick(prisma);
    const elapsedMs = performance.now() - start;

    // Every one of the 20 real, independently-tokenized, fully-authorized
    // claims made it all the way through: RLS-scoped candidate fetch, PHI
    // detokenize, patient-data-completeness check, triage probe (real, no
    // signal for a fresh claim), validateDispatch (real guard chain), and
    // the call to initiateCall — proving the full pipeline works at N=20,
    // not just the ordering primitive.
    expect(initiateCallMock).toHaveBeenCalledTimes(FLEET_SIZE);

    const calledPracticeIds = initiateCallMock.mock.calls.map((call) => (call[0] as { practiceId: string }).practiceId);
    expect(new Set(calledPracticeIds).size).toBe(FLEET_SIZE);
    for (const p of fleet) {
      expect(calledPracticeIds).toContain(p.id);
    }

    // Every dispatch produced a real CallAttempt row with a real vapiCallId —
    // not just a mock call, the DB write side of dispatch also completed.
    const attempts = await prisma.callAttempt.findMany({
      where: { claim: { practiceId: { in: fleet.map((p) => p.id) } } },
    });
    expect(attempts).toHaveLength(FLEET_SIZE);
    expect(attempts.every((a) => a.vapiCallId?.startsWith('vapi-load-'))).toBe(true);

    // A generous but real bound: 20 practices through the full guard chain,
    // PHI vault, and DB writes should not take anywhere near a full 60s tick
    // interval. This is the number that would catch an accidental serial
    // bottleneck (N+1 query, unnecessarily serialized awaits) as the fleet grows.
    expect(elapsedMs).toBeLessThan(15_000);
  }, 30_000);

  it('does not double-dispatch the same claim on a second tick with no completed calls', async () => {
    initiateCallMock.mockClear();

    // M-7: one live call per practice at a time. Every practice from the
    // previous test still has an open (uncompleted) CallAttempt — a second
    // tick must not dispatch any of them again — and it must reach that
    // check by actually renewing its own dispatch lease and iterating the
    // fleet, not by being locked out at the lease step. Two real consecutive
    // ticks from the same process is exactly the sequence that exposed a
    // severe bug: the lease TTL outliving the tick interval meant a process
    // could never reclaim its own lease, so every tick after the first
    // silently stopped dispatching forever on a single-machine deployment.
    // A direct signal that renewal succeeded (not lease-precision-dependent
    // timestamp comparison, which can tie at millisecond resolution when two
    // ticks run this close together): the tick logs this exact warning only
    // when claimTickLease() is rejected.
    const warnSpy = vi.spyOn(logger, 'warn');
    await runDeskQueueTick(prisma);

    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('another replica holds the dispatch lease'),
      expect.anything(),
    );
    expect(initiateCallMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  }, 30_000);

  it('renews its own lease across a sustained run of consecutive ticks with no errors', async () => {
    // A single 2-tick proof caught the renewal bug, but the same class of bug
    // (something that degrades only after repeated cycles — a slow drift, a
    // connection leak) wouldn't necessarily show up in just two. This runs
    // ten real consecutive ticks — no completed calls between them, so every
    // tick after the first should be a same-instance renewal plus an M-7
    // no-op, exactly like sustained real operation over several minutes.
    const TICKS = 10;
    for (let i = 0; i < TICKS; i++) {
      await expect(runDeskQueueTick(prisma)).resolves.not.toThrow();
    }
    const lease = await prisma.queueEngineLease.findUnique({ where: { id: 'global' } });
    expect(lease?.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
  }, 60_000);
});
