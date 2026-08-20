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

// when CI happens to run it. validateDispatch and CARRIER_CONFIGS stay
// real — this test's whole point is exercising the real dispatch guard
// chain, not bypassing it.
//
// Mocking the exported isWithinCallWindow() does NOT work for this: it and
// validateDispatch() are defined in the same module (carriers/adapter.ts),
// and validateDispatch() calls isWithinCallWindow() as a bare local
// reference, not through the module's export binding — vi.mock()'s
// factory-replacement object is never consulted for that internal call, so
// the override was silently a no-op. Confirmed directly: this test failed
// for real, reproducibly, whenever it happened to run outside real
// business hours, despite the mock "in place." Faking only `Date` (not all
// timers, so real setTimeout/I-O in Prisma etc. still runs on real time)
// pins what `new Date()` returns everywhere, including inside
// validateDispatch's own internal call — the one seam that actually
// controls this check.
const FIXED_BUSINESS_HOURS_INSTANT = new Date('2026-08-05T14:00:00.000Z'); // Wed 10:00 EDT

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_BUSINESS_HOURS_INSTANT);
});

afterAll(() => {
  vi.useRealTimers();
});

process.env.VAPI_MAX_CONCURRENT_CALLS = '500';
process.env.VAPI_CONCURRENCY_RESERVE = '0';

const { prisma } = await import('../src/server/index.js');
const { runDeskQueueTick } = await import('../src/server/frontDesk/queueEngine.js');
const { createPracticeForTests } = await import('./factories/practice.js');
const { defaultPracticeSettings, updatePracticeSettings } = await import(
  '../src/server/services/practiceSettingsService.js'
);
const { piiVault } = await import('../src/pii-vault.js');
const { default: logger } = await import('../src/server/observability/logger.js');

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
  // vitest.config.ts runs the suite in one sequential process (maxWorkers: 1)
  // — leaving this set would make isWithinCallWindow always return true for
  // every later file, silently breaking tests that assert real business-hour
  // rejection (e.g. tests/phase-5/carrier-adapter.test.ts's Sat/Sun/early/late
  // isWithinCallWindow cases).
  delete process.env.COLLECTRX_FORCE_CALL_WINDOW;
  await prisma.$disconnect().catch(() => undefined);
});

const FLEET_SIZE = 20;

interface FleetPractice {
  id: string;
  claimId: string;
}

async function seedDispatchablePractice(carrierId: CarrierId): Promise<FleetPractice> {
  const practice = await createPracticeForTests(prisma);

  const settings = defaultPracticeSettings();
  settings.voiceAgentEnabled = true;
  settings.carrierConfigs = settings.carrierConfigs.map((c) =>
    c.carrierId === carrierId
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
      carrierId,
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
    // Date is already pinned to FIXED_BUSINESS_HOURS_INSTANT by the file-level
    // beforeAll above, which runs before this one — required here too since
    // seedDispatchablePractice() below stamps callQueue.scheduledFor from
    // Date.now(), and it needs to land inside the same pinned window the
    // dispatch checks will later evaluate against.

    // queue_engine_lease is a global singleton row (by design — one lease
    // for the whole fleet). A previous test process can leave it live for up
    // to LEASE_TTL_MS under ITS OWN instance ID; a fresh `vitest run` is a
    // new Node process with a different instance ID, so without this reset
    // it gets correctly-but-unhelpfully rejected by a lease it doesn't own,
    // for up to 90s after any prior run. Reproduced directly: back-to-back
    // invocations of this file failed every time until this reset was added.
    await prisma.queueEngineLease.deleteMany({ where: { id: 'global' } });
    // Spread across all 6 carriers (4 max per carrier well under
    // CARRIER_CONCURRENCY_LIMITS' fleet-wide cap of 5/carrier — see
    // src/billing/tiers.ts) so that real, intentional guard doesn't throttle
    // this test's own fleet before it can prove the pipeline dispatches all
    // 20; per-carrier scarcity has its own dedicated coverage in
    // tests/queueEngineFairnessAndLease.test.ts.
    const CARRIERS: CarrierId[] = ['sun_life', 'canada_life', 'manulife', 'green_shield', 'rbc', 'telus_adjudicare'];
    fleet = await Promise.all(
      Array.from({ length: FLEET_SIZE }, (_, i) => seedDispatchablePractice(CARRIERS[i % CARRIERS.length])),
    );
  }, 60_000);

  afterAll(async () => {
    await cleanupFleet(fleet);
    await prisma.queueEngineLease.deleteMany({ where: { id: 'global' } });
    vi.useRealTimers();
  });

  it('dispatches every practice through the real pipeline with no errors, in bounded wall-clock time', async () => {
    initiateCallMock.mockClear();

    // performance.now() rather than Date.now(): Date is pinned by the
    // file-level beforeAll above (so isWithinCallWindow() sees real business
    // hours without a separate COLLECTRX_FORCE_CALL_WINDOW escape hatch), and
    // a pinned Date.now() would always read ~0ms elapsed, making the bound
    // below assert nothing.
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
