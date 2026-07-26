// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Queue Engine at Scale: 50-Practice Load Test
//
// Validates the dispatch/scheduling/safety-rule stack under realistic
// multi-tenant contention: per-carrier concurrency ceiling, CARRIER_BLOCK
// organization-wide propagation, COGS breaker per-practice isolation, RLS
// isolation, and no starvation — all against a real seeded Postgres database
// and the real runDeskQueueTick, with only initiateCall mocked (no real
// Vapi/Twilio calls, no telephony cost, no CARRIER_BLOCK risk to real carrier
// relationships). See tests/loadtest/seedScenarioFleet.ts for the fleet shape.
//
// NOT part of the default `npm test` suite — run via `npm run test:loadtest`.
// A single full-fleet run legitimately takes longer than a normal unit test.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CarrierId, PrismaClient } from '@prisma/client';

const initiateCallMock = vi.fn(async () => ({
  vapiCallId: `mock-${Date.now()}-${Math.random().toString(36).slice(2)}`,
}));

// Partial mock: adapter.ts also imports CARRIER_PHONE_MAP from this same
// module to build CARRIER_CONFIGS at load time — a full replacement breaks
// the whole module graph, not just the two functions under test here.
vi.mock('../../src/vapi/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/vapi/client.js')>();
  return {
    ...actual,
    initiateCall: (...args: unknown[]) => initiateCallMock(...args),
    endVapiCall: vi.fn(async () => undefined),
  };
});

const { prisma } = await import('../../src/server/index.js');
const { runDeskQueueTick } = await import('../../src/server/frontDesk/queueEngine.js');
const { runWithRlsBypass } = await import('../../src/server/db/rlsContext.js');
const { CARRIER_CONCURRENCY_LIMITS, DEFAULT_CARRIER_CONCURRENCY_LIMIT } = await import('../../src/billing/tiers.js');
const { seedScenarioFleet, teardownScenarioFleet } = await import('./seedScenarioFleet.js');
type ScenarioFleet = Awaited<ReturnType<typeof seedScenarioFleet>>;

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn('[loadtest] DATABASE_URL unreachable — skipping:', (e as Error).message);
}

const TICKS = 80;

/** Simulates the Vapi end-of-call webhook: closes every open attempt this fleet has in flight
 * so practices keep cycling through their backlog instead of getting stuck after one dispatch. */
async function completeAllInFlightCalls(fleet: ScenarioFleet): Promise<void> {
  await runWithRlsBypass(async () => {
    const openAttempts = await prisma.callAttempt.findMany({
      where: { completedAt: null, claim: { practiceId: { in: fleet.allPracticeIds } } },
      select: { id: true, claimId: true },
    });
    for (const attempt of openAttempts) {
      await prisma.callAttempt.update({
        where: { id: attempt.id },
        data: { completedAt: new Date(), durationSeconds: 120 },
      });
      await prisma.callQueue.update({
        where: { claimId: attempt.claimId },
        data: { status: 'COMPLETED' },
      });
    }
  });
}

async function snapshotInFlightPerCarrier(fleet: ScenarioFleet): Promise<Map<CarrierId, number>> {
  const inFlight = await runWithRlsBypass(() =>
    prisma.callAttempt.findMany({
      where: { completedAt: null, claim: { practiceId: { in: fleet.allPracticeIds } } },
      select: { claim: { select: { carrierId: true } } },
    }),
  );
  const perCarrier = new Map<CarrierId, number>();
  for (const a of inFlight) {
    perCarrier.set(a.claim.carrierId, (perCarrier.get(a.claim.carrierId) ?? 0) + 1);
  }
  return perCarrier;
}

describe.skipIf(!dbReady)('Queue engine at scale — 50-practice fleet', () => {
  let fleet: ScenarioFleet;

  beforeAll(async () => {
    process.env.COLLECTRX_FORCE_CALL_WINDOW = '1';

    // vapiSlotBudget() (queueEngine.ts) counts open CallAttempt rows
    // GLOBALLY, with no practice filter — exactly as it does in production,
    // where it's a real cross-tenant Vapi account concurrency cap. A shared
    // local test database can easily carry leftover open attempts from
    // other test runs that never got a chance to mark completedAt. Left
    // alone, that leftover state silently exhausts the global budget before
    // this test's own first tick, and every tick bails with nothing
    // dispatched — which looks like a bug in the fleet, not what it is.
    // Marking them completed (not deleting) is the conservative fix: it
    // frees the budget without touching whatever else those rows' FKs
    // still reference.
    await runWithRlsBypass(() =>
      prisma.callAttempt.updateMany({
        where: { completedAt: null },
        data: { completedAt: new Date() },
      }),
    );

    fleet = await seedScenarioFleet(prisma as unknown as PrismaClient, { standaloneCount: 44 });
  }, 120_000);

  afterAll(async () => {
    delete process.env.COLLECTRX_FORCE_CALL_WINDOW;
    if (fleet) await teardownScenarioFleet(prisma as unknown as PrismaClient, fleet);
    await prisma.$disconnect().catch(() => undefined);
  });

  it(
    'holds every dispatch-safety invariant under full-fleet concurrent load',
    async () => {
      const maxObservedPerCarrier = new Map<CarrierId, number>();

      for (let tick = 0; tick < TICKS; tick++) {
        await runDeskQueueTick(prisma as unknown as PrismaClient);

        const perCarrier = await snapshotInFlightPerCarrier(fleet);
        for (const [carrierId, count] of perCarrier) {
          if (count > (maxObservedPerCarrier.get(carrierId) ?? 0)) {
            maxObservedPerCarrier.set(carrierId, count);
          }
          const limit = CARRIER_CONCURRENCY_LIMITS[carrierId] ?? DEFAULT_CARRIER_CONCURRENCY_LIMIT;
          expect(count, `carrier ${carrierId} exceeded its concurrency ceiling of ${limit} at tick ${tick}`).toBeLessThanOrEqual(limit);
        }

        await completeAllInFlightCalls(fleet);
      }

      console.warn(
        '[loadtest] max observed concurrent calls per carrier across the run:',
        Object.fromEntries(maxObservedPerCarrier),
      );

      // Diagnostic breakdown — how the fleet's claims actually resolved,
      // useful for telling "nothing dispatched" apart from "everything got
      // legitimately deferred/blocked/escalated" before trusting either.
      const statusBreakdown = await runWithRlsBypass(() =>
        prisma.callQueue.groupBy({
          by: ['status'],
          where: { practiceId: { in: fleet.allPracticeIds } },
          _count: { _all: true },
        }),
      );
      console.warn('[loadtest] final CallQueue status breakdown:', statusBreakdown);

      const deferralBreakdown = await runWithRlsBypass(() =>
        prisma.callQueue.groupBy({
          by: ['dispatchDeferralCode'],
          where: { practiceId: { in: fleet.allPracticeIds } },
          _count: { _all: true },
        }),
      );
      console.warn('[loadtest] deferral code breakdown:', deferralBreakdown);
      console.warn('[loadtest] initiateCall mock call count:', initiateCallMock.mock.calls.length);

      // ── Invariant: no per-carrier over-concurrency, ever ──────────────────
      // (Asserted every tick above; the loop completing at all confirms it
      // held for the full run, not just a lucky snapshot.)

      // ── Invariant: no starvation ───────────────────────────────────────────
      // A PENDING entry whose scheduledFor is already in the past AND has no
      // dispatchDeferralCode was never actually considered by the engine —
      // that's true starvation, distinct from a claim legitimately deferred
      // (staff-action, claim-age, carrier-concurrency-wait), which correctly
      // stays PENDING with a future scheduledFor and a recorded code.
      // The COGS-paused practice is excluded: canMakeCall() rejects it at the
      // practice-wide gate in queueEngine.ts before any candidate is looked at,
      // so its entries never get a per-entry code — by the same design as
      // VOICE_AGENT_DISABLED/OUTSIDE_CALL_WINDOW (settleBlockedCandidate's
      // 'stop' disposition), not a bug. It's covered by its own dedicated
      // isolation check below instead.
      const starved = await runWithRlsBypass(() =>
        prisma.callQueue.count({
          where: {
            practiceId: { in: fleet.allPracticeIds.filter((id) => id !== fleet.cogsPausedPracticeId) },
            status: 'PENDING',
            scheduledFor: { lte: new Date() },
            dispatchDeferralCode: null,
          },
        }),
      );
      expect(starved, 'found PENDING claims past due with no deferral reason recorded — the engine never got to them').toBe(0);

      // ── Invariant: CARRIER_BLOCK propagates to org siblings, precisely ────
      const siblingIds = fleet.sixLocationPracticeIds.filter((id) => id !== fleet.blockedPracticeId);
      const siblingBlockedQueue = await runWithRlsBypass(() =>
        prisma.callQueue.findMany({
          where: {
            practiceId: { in: siblingIds },
            claim: { carrierId: fleet.blockedCarrierId },
          },
          select: { practiceId: true, status: true },
        }),
      );
      for (const practiceId of siblingIds) {
        const entriesForPractice = siblingBlockedQueue.filter((e) => e.practiceId === practiceId);
        expect(entriesForPractice.length, `sibling ${practiceId} should have its guaranteed ${fleet.blockedCarrierId} claim seeded`).toBeGreaterThan(0);
        expect(
          entriesForPractice.every((e) => e.status === 'BLOCKED'),
          `sibling ${practiceId} has a non-BLOCKED ${fleet.blockedCarrierId} entry — org-wide propagation did not reach it`,
        ).toBe(true);
      }

      // Unrelated orgs/standalones must NOT be over-blocked by the same event.
      const unrelatedPracticeIds = [
        ...fleet.smallOrgPracticeIds.flat(),
        ...fleet.standalonePracticeIds.slice(0, 3),
      ];
      const unrelatedQueue = await runWithRlsBypass(() =>
        prisma.callQueue.findMany({
          where: {
            practiceId: { in: unrelatedPracticeIds },
            claim: { carrierId: fleet.blockedCarrierId },
          },
          select: { practiceId: true, status: true },
        }),
      );
      const wronglyBlocked = unrelatedQueue.filter((e) => e.status === 'BLOCKED');
      expect(wronglyBlocked, 'unrelated practices were blocked by a sibling org\'s CARRIER_BLOCK event — propagation over-reached').toHaveLength(0);

      // ── Invariant: COGS breaker isolates per practice ──────────────────────
      const pausedPractice = await prisma.practice.findUnique({ where: { id: fleet.cogsPausedPracticeId } });
      expect(pausedPractice?.callsPaused).toBe(true);
      expect(pausedPractice?.callsPausedReason).toBe('cogs_breaker');
      const pausedDispatched = await runWithRlsBypass(() =>
        prisma.callQueue.count({
          where: { practiceId: fleet.cogsPausedPracticeId, status: { in: ['IN_PROGRESS', 'COMPLETED'] } },
        }),
      );
      expect(pausedDispatched, 'a COGS-paused practice dispatched a call — the breaker did not isolate it').toBe(0);

      const throttledDispatched = await runWithRlsBypass(() =>
        prisma.callQueue.findMany({
          where: { practiceId: fleet.cogsThrottledPracticeId, status: { in: ['IN_PROGRESS', 'COMPLETED'] } },
          select: { priority: true },
        }),
      );
      expect(
        throttledDispatched.every((e) => e.priority === 'HIGH' || e.priority === 'URGENT'),
        'a COGS-throttled practice dispatched a NORMAL-priority claim — essentialOnly was not honored',
      ).toBe(true);

      // Everyone else must be unaffected by either practice's COGS state.
      const otherStandalonesDispatched = await runWithRlsBypass(() =>
        prisma.callQueue.count({
          where: {
            practiceId: { in: fleet.standalonePracticeIds },
            status: { in: ['IN_PROGRESS', 'COMPLETED'] },
          },
        }),
      );
      expect(otherStandalonesDispatched, 'no standalone practice dispatched anything — COGS isolation may have bled into the fleet').toBeGreaterThan(0);

      // ── Invariant: RLS never leaks under concurrency ───────────────────────
      // Every CallQueue row's practiceId must match its own claim's practiceId
      // — a cross-practice attribution here would mean RLS scoping broke
      // somewhere in the dispatch path under load.
      const allQueueWithClaim = await runWithRlsBypass(() =>
        prisma.callQueue.findMany({
          where: { practiceId: { in: fleet.allPracticeIds } },
          select: { practiceId: true, claim: { select: { practiceId: true } } },
        }),
      );
      const misattributed = allQueueWithClaim.filter((e) => e.practiceId !== e.claim.practiceId);
      expect(misattributed, 'found CallQueue rows whose practiceId does not match their own claim\'s practiceId').toHaveLength(0);

      // ── Edge cases didn't crash the run ────────────────────────────────────
      // (If the empty-backlog or all-too-young practice had thrown, the tick
      // loop's per-practice try/catch would have logged it and continued —
      // the fact that every invariant above still holds confirms neither
      // broke isolation for practices after them in the loop.)
    },
    600_000,
  );
});
