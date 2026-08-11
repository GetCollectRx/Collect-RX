/**
 * CARRIER_BLOCK — end-to-end coverage gaps not exercised elsewhere.
 *
 * Existing coverage before this file:
 *   - tests/workflowDispatchSafetyRules.test.ts: real-DB validateDispatch()/
 *     checkCarrierBlock() unit coverage, but only ever within a single practice.
 *   - tests/frontDesk/queueEngine.dispatch.test.ts: exercises the queue tick's
 *     *handling* of a CARRIER_BLOCK guard response, but with validateDispatch
 *     itself mocked out — the real live-DB block check never runs.
 *   - tests/frontDesk/carrierBlockService.test.ts: applyCarrierBlock's active-call
 *     termination (endVapiCall, callAttempt outcome) — fully mocked Prisma.
 *
 * None of the above exercise, against a real database:
 *   1. Tenant isolation — Practice A's block must not touch Practice B.
 *   2. A claim created for a carrier AFTER the block already landed — the PMS/CSV
 *      importer (prismaClaimImporter.ts) has no CARRIER_BLOCK awareness at all
 *      and always creates new claims as PENDING; the only thing standing between
 *      that and a dial is checkCarrierBlock() re-running live at dispatch time.
 *   3. The real runDeskQueueTick end-to-end with a genuine CarrierBlockEvent row
 *      (queueEngine.dispatch.test.ts proves this with validateDispatch mocked;
 *      this proves it with the real guard chain).
 *   4. The manual "call now" HTTP route (POST /api/insurance/queue/trigger/:id)
 *      — a second, independent dispatch entry point (src/routes/insurance.ts)
 *      that also calls validateDispatch, but had zero test coverage of
 *      CARRIER_BLOCK specifically.
 *
 * DB-dependent; skipped with a clear log if DATABASE_URL is unreachable — this
 * file follows the existing convention of the other dispatch-safety suites
 * rather than the workflowDispatchSafetyRules.test.ts hard-fail convention,
 * since it's additive coverage, not the sole guardian of the rule.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { CarrierId } from '@prisma/client';

const initiateCallMock = vi.fn(async () => ({
  vapiCallId: `vapi-e2e-${Math.random().toString(36).slice(2, 10)}`,
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

// Only the call-window gate is bypassed (test-time determinism) — everything
// else in the guard chain, including checkCarrierBlock, runs for real.
vi.mock('../src/carriers/adapter.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/carriers/adapter.js')>();
  return { ...actual, isWithinCallWindow: () => true };
});

const { app, prisma } = await import('../src/server/index.js');
const { runDeskQueueTick } = await import('../src/server/frontDesk/queueEngine.js');
const { applyCarrierBlock } = await import('../src/server/frontDesk/carrierBlockService.js');
const { validateDispatch } = await import('../src/carriers/adapter.js');
const { createPracticeForTests, createPracticeWithOwnerForTests, cleanupPracticeWithUsers } =
  await import('./factories/practice.js');
const { defaultPracticeSettings, updatePracticeSettings } = await import(
  '../src/server/services/practiceSettingsService.js'
);
const { piiVault } = await import('../src/pii-vault.js');
const { COOKIE_NAME, signUserToken } = await import('../src/server/authToken.js');

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn(
    '[carrierBlockE2E] DATABASE_URL unreachable — DB-dependent tests will be skipped:',
    (e as Error).message,
  );
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

const BLOCKED_CARRIER: CarrierId = 'sun_life';

// validateDispatch()'s business-hours check (isWithinCallWindow) is called
// internally within src/carriers/adapter.ts's own module scope — a same-file
// call vi.mock cannot intercept, since it resolves to the real declaration,
// not the mocked export other modules see. Any validateDispatch() call here
// that expects `allowed: true` must therefore pin scheduledFor to a fixed
// in-window time, exactly like tests/workflowDispatchSafetyRules.test.ts
// already does — otherwise this test is silently real-time-dependent and
// fails whenever it happens to run outside Mon–Fri 08:00–17:00 Eastern.
const TUESDAY_10AM_ET = new Date('2026-04-14T14:00:00Z');

async function authorizedPractice(namePrefix: string) {
  const practice = await createPracticeForTests(prisma);
  const settings = defaultPracticeSettings();
  settings.voiceAgentEnabled = true;
  settings.carrierConfigs = settings.carrierConfigs.map((c) =>
    c.carrierId === BLOCKED_CARRIER
      ? { ...c, authorizationSubmitted: true, providerNumber: `PN-${namePrefix}-${practice.id.slice(0, 8)}` }
      : c,
  );
  await updatePracticeSettings(prisma, practice.id, settings);
  return practice;
}

async function makeClaim(practiceId: string, opts: { claimNumber: string; daysOutstanding?: number }) {
  const patientToken = piiVault.tokenize(
    {
      patientName: 'E2E Test Patient',
      dateOfBirth: '1985-06-15',
      subscriberId: `SUB-${practiceId.slice(0, 8)}`,
      groupPolicyNumber: `GRP-${practiceId.slice(0, 8)}`,
    },
    'carrier_block_e2e_test',
    practiceId,
  );
  return prisma.insuranceClaim.create({
    data: {
      practiceId,
      carrierId: BLOCKED_CARRIER,
      claimNumber: opts.claimNumber,
      patientToken,
      billedAmount: 250,
      outstandingAmount: 250,
      daysOutstanding: opts.daysOutstanding ?? 45,
      status: 'PENDING',
    },
  });
}

describe.skipIf(!dbReady)('CARRIER_BLOCK — tenant isolation', () => {
  let practiceA: { id: string };
  let practiceB: { id: string };

  beforeAll(async () => {
    if (!dbReady) return;
    practiceA = await authorizedPractice('ISO-A');
    practiceB = await authorizedPractice('ISO-B');
  }, 30_000);

  afterAll(async () => {
    if (!dbReady) return;
    for (const p of [practiceA, practiceB]) {
      await prisma.carrierBlockEvent.deleteMany({ where: { practiceId: p.id } });
      await prisma.callAttempt.deleteMany({ where: { claim: { practiceId: p.id } } });
      await prisma.insuranceClaim.deleteMany({ where: { practiceId: p.id } });
      await prisma.practice.delete({ where: { id: p.id } }).catch(() => undefined);
    }
  });

  it('blocking sun_life for Practice A does not block sun_life for Practice B', async () => {
    const claimA = await makeClaim(practiceA.id, { claimNumber: 'CLM-ISO-A' });
    const claimB = await makeClaim(practiceB.id, { claimNumber: 'CLM-ISO-B' });

    await applyCarrierBlock(prisma, {
      practiceId: practiceA.id,
      carrierId: BLOCKED_CARRIER,
      vapiCallId: 'vapi-iso-trigger',
      reason: 'IVR detected automation (Practice A only)',
      hangVapi: false,
    });

    const resultA = await validateDispatch(prisma, {
      practiceId: practiceA.id,
      claimId: claimA.id,
      carrierId: BLOCKED_CARRIER,
      daysOutstanding: 45,
      attemptsSoFar: 0,
      claimStatus: 'PENDING',
      scheduledFor: TUESDAY_10AM_ET,
    });
    expect(resultA.allowed).toBe(false);
    expect(resultA.code).toBe('CARRIER_BLOCK');

    const resultB = await validateDispatch(prisma, {
      practiceId: practiceB.id,
      claimId: claimB.id,
      carrierId: BLOCKED_CARRIER,
      daysOutstanding: 45,
      attemptsSoFar: 0,
      claimStatus: 'PENDING',
      scheduledFor: TUESDAY_10AM_ET,
    });
    expect(resultB.allowed).toBe(true);

    const claimBAfter = await prisma.insuranceClaim.findUnique({ where: { id: claimB.id } });
    expect(claimBAfter?.status).toBe('PENDING');
  }, 30_000);

  it('rejects a claim created for the carrier AFTER the block was already active', async () => {
    // applyCarrierBlock only reaches claims that already existed at block time
    // (insuranceClaim.updateMany over PENDING/IN_QUEUE/CALLING) — the PMS/CSV
    // importer has no CARRIER_BLOCK awareness and always creates new claims as
    // PENDING (src/server/pms/prismaClaimImporter.ts). This proves the live
    // checkCarrierBlock() re-check at dispatch time is what actually protects
    // a claim imported after the fact, not any state stamped at import.
    const lateClaim = await makeClaim(practiceA.id, { claimNumber: 'CLM-ISO-A-LATE' });
    expect(lateClaim.status).toBe('PENDING');

    const result = await validateDispatch(prisma, {
      practiceId: practiceA.id,
      claimId: lateClaim.id,
      carrierId: BLOCKED_CARRIER,
      daysOutstanding: 45,
      attemptsSoFar: 0,
      claimStatus: 'PENDING',
      scheduledFor: TUESDAY_10AM_ET,
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('CARRIER_BLOCK');
  }, 30_000);
});

describe.skipIf(!dbReady)('CARRIER_BLOCK — real runDeskQueueTick', () => {
  let practice: { id: string };
  let claimId: string;
  let queueId: string;

  beforeAll(async () => {
    if (!dbReady) return;
    await prisma.queueEngineLease.deleteMany({ where: { id: 'global' } });
    // vapiSlotBudget() reads prisma.callAttempt.count({ completedAt: null })
    // GLOBALLY, by design (see tests/dsoLoadCapacity.test.ts's header comment) —
    // it also picks up any open CallAttempt rows left behind by other test
    // files sharing this Postgres instance. Budget generously so ambient
    // noise from elsewhere in the suite can never cause runDeskQueueTick to
    // bail out before reaching this practice at all, which would produce a
    // false failure indistinguishable from "the CARRIER_BLOCK guard didn't
    // fire" (both leave the queue entry PENDING instead of BLOCKED).
    vi.stubEnv('VAPI_MAX_CONCURRENT_CALLS', '500');
    vi.stubEnv('VAPI_CONCURRENCY_RESERVE', '0');
    practice = await authorizedPractice('TICK');
    const claim = await makeClaim(practice.id, { claimNumber: 'CLM-TICK-BLOCKED' });
    claimId = claim.id;
    const queueEntry = await prisma.callQueue.create({
      data: {
        practiceId: practice.id,
        claimId: claim.id,
        scheduledFor: new Date(Date.now() - 1000),
        status: 'PENDING',
      },
    });
    queueId = queueEntry.id;

    await applyCarrierBlock(prisma, {
      practiceId: practice.id,
      carrierId: BLOCKED_CARRIER,
      vapiCallId: 'vapi-tick-trigger',
      reason: 'IVR detected automation before this candidate ever reached the head of the queue',
      hangVapi: false,
    });
    // applyCarrierBlock already parks pre-existing PENDING queue/claim rows as
    // BLOCKED directly — reset them back to PENDING so this test proves the
    // *tick's own* live guard check catches it too, not just the one-time
    // sweep applyCarrierBlock did at block time.
    await prisma.callQueue.update({ where: { id: queueId }, data: { status: 'PENDING' } });
    await prisma.insuranceClaim.update({ where: { id: claimId }, data: { status: 'PENDING' } });
  }, 30_000);

  afterAll(async () => {
    if (!dbReady) return;
    await prisma.carrierBlockEvent.deleteMany({ where: { practiceId: practice.id } });
    await prisma.callAttempt.deleteMany({ where: { claim: { practiceId: practice.id } } });
    await prisma.callQueue.deleteMany({ where: { practiceId: practice.id } });
    await prisma.insuranceClaim.deleteMany({ where: { practiceId: practice.id } });
    await prisma.practiceDeskState.deleteMany({ where: { practiceId: practice.id } });
    await prisma.practice.delete({ where: { id: practice.id } }).catch(() => undefined);
    await prisma.queueEngineLease.deleteMany({ where: { id: 'global' } });
    vi.unstubAllEnvs();
  });

  it('never reaches Vapi for a blocked-carrier candidate and settles it as BLOCKED with no CallAttempt', async () => {
    initiateCallMock.mockClear();

    await runDeskQueueTick(prisma);

    const callsForThisClaim = initiateCallMock.mock.calls.filter(
      (call) => (call[0] as { claimId?: string }).claimId === claimId,
    );
    expect(callsForThisClaim).toHaveLength(0);

    const queueAfter = await prisma.callQueue.findUnique({ where: { id: queueId } });
    expect(queueAfter?.status).toBe('BLOCKED');
    expect(queueAfter?.dispatchDeferralCode).toBe('CARRIER_BLOCK');

    const claimAfter = await prisma.insuranceClaim.findUnique({ where: { id: claimId } });
    expect(claimAfter?.status).toBe('BLOCKED');

    const attempts = await prisma.callAttempt.findMany({ where: { claimId } });
    expect(attempts).toHaveLength(0);
  }, 30_000);
});

describe.skipIf(!dbReady)('CARRIER_BLOCK — manual "call now" HTTP route (POST /api/insurance/queue/trigger/:claimId)', () => {
  let practiceSetup: Awaited<ReturnType<typeof createPracticeWithOwnerForTests>>;
  let claimId: string;

  function authCookie(): string {
    return `${COOKIE_NAME}=${signUserToken({
      userId: practiceSetup.user.id,
      practiceId: practiceSetup.practice.id,
      role: 'practice_owner',
    })}`;
  }

  beforeAll(async () => {
    if (!dbReady) return;
    practiceSetup = await createPracticeWithOwnerForTests(prisma);
    const settings = defaultPracticeSettings();
    settings.voiceAgentEnabled = true;
    settings.carrierConfigs = settings.carrierConfigs.map((c) =>
      c.carrierId === BLOCKED_CARRIER
        ? { ...c, authorizationSubmitted: true, providerNumber: `PN-HTTP-${practiceSetup.practice.id.slice(0, 8)}` }
        : c,
    );
    await updatePracticeSettings(prisma, practiceSetup.practice.id, settings);

    const claim = await makeClaim(practiceSetup.practice.id, { claimNumber: 'CLM-HTTP-BLOCKED' });
    claimId = claim.id;

    await applyCarrierBlock(prisma, {
      practiceId: practiceSetup.practice.id,
      carrierId: BLOCKED_CARRIER,
      vapiCallId: 'vapi-http-trigger',
      reason: 'IVR detected automation',
      hangVapi: false,
    });
    // Same reasoning as the tick test above: prove the route's own guard
    // check catches it, not just applyCarrierBlock's one-time sweep.
    await prisma.insuranceClaim.update({ where: { id: claimId }, data: { status: 'PENDING' } });
  }, 30_000);

  afterAll(async () => {
    if (!dbReady) return;
    await prisma.carrierBlockEvent.deleteMany({ where: { practiceId: practiceSetup.practice.id } });
    await prisma.callAttempt.deleteMany({ where: { claim: { practiceId: practiceSetup.practice.id } } });
    await prisma.callQueue.deleteMany({ where: { practiceId: practiceSetup.practice.id } });
    await prisma.insuranceClaim.deleteMany({ where: { practiceId: practiceSetup.practice.id } });
    await cleanupPracticeWithUsers(prisma, practiceSetup.practice.id);
  });

  it('rejects with 422 and code CARRIER_BLOCK, never dials Vapi, and never flips the claim to CALLING', async () => {
    initiateCallMock.mockClear();

    const res = await request(app)
      .post(`/api/insurance/queue/trigger/${claimId}`)
      .set('Cookie', authCookie());

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CARRIER_BLOCK');
    expect(initiateCallMock).not.toHaveBeenCalled();

    const claimAfter = await prisma.insuranceClaim.findUnique({ where: { id: claimId } });
    expect(claimAfter?.status).not.toBe('CALLING');

    const attempts = await prisma.callAttempt.findMany({ where: { claimId } });
    expect(attempts).toHaveLength(0);
  }, 30_000);
});
