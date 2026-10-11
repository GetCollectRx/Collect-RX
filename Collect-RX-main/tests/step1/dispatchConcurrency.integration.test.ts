/**
 * Step 1 (T4, T5): one claim, one dial, whichever way two dispatchers race.
 *
 * Real Postgres and the real route, scheduler and guard chain; only the Vapi
 * dial, the plan gate and the pre-call triage probe are replaced. Skipped with
 * a log line when DATABASE_URL is unreachable, like the other DB-backed suites.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const h = vi.hoisted(() => ({
  dials: [] as Array<{ claimId: string; idempotencyKey?: string; squadId?: string }>,
  dialDelayMs: 0,
  triageGate: null as null | Promise<void>,
  triageEntered: null as null | (() => void),
}));

vi.mock('../../src/vapi/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/vapi/client.js')>();
  const dial = async (params: { claimId: string; idempotencyKey?: string; squadId?: string }) => {
    h.dials.push({ claimId: params.claimId, idempotencyKey: params.idempotencyKey, squadId: params.squadId });
    if (h.dialDelayMs) await new Promise((r) => setTimeout(r, h.dialDelayMs));
    return {
      vapiCallId: `vapi-conc-${Math.random().toString(36).slice(2, 12)}`,
      status: 'queued' as const,
      createdAt: new Date().toISOString(),
    };
  };
  return {
    ...actual,
    initiateCall: dial,
    endVapiCall: vi.fn(async () => undefined),
    vapiClient: { ...actual.vapiClient, initiateCall: dial, endVapiCall: vi.fn(async () => undefined) },
  };
});

vi.mock('../../src/server/plans/planBridge.js', () => ({
  canMakeCall: vi.fn(async () => ({ allowed: true })),
  gateBlockMessage: vi.fn(() => 'blocked'),
}));

// The pre-call triage probe sits between the scheduler loading its candidate and
// dialing it, so it is where the test holds the scheduler to let a manual click
// finish first (the widest real race window).
vi.mock('../../src/server/triage/claimStatusProbe.js', () => ({
  probeClaimStatus: vi.fn(async () => {
    h.triageEntered?.();
    if (h.triageGate) await h.triageGate;
    return null;
  }),
}));

vi.mock('../../src/carriers/adapter.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/carriers/adapter.js')>();
  return { ...actual, isWithinCallWindow: () => true };
});

const { app, prisma } = await import('../../src/server/index.js');
const { runDeskQueueTick } = await import('../../src/server/frontDesk/queueEngine.js');
const { createPracticeWithOwnerForTests, cleanupPracticeWithUsers } = await import('../factories/practice.js');
const { defaultPracticeSettings, updatePracticeSettings } = await import(
  '../../src/server/services/practiceSettingsService.js'
);
const { piiVault } = await import('../../src/pii-vault.js');
const { COOKIE_NAME, signUserToken } = await import('../../src/server/authToken.js');
const { recordDispatchedCallAttempt } = await import('../../src/server/frontDesk/callAttemptRecording.js');

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn('[dispatchConcurrency] DATABASE_URL unreachable, skipping:', (e as Error).message);
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

// A Tuesday 10:00 Eastern that is later than the real clock, so queue rows
// created with the database's now() are already due.
const DISPATCH_TIME = new Date('2026-10-20T14:00:00Z');

describe.skipIf(!dbReady)('one claim, one dial (real Postgres)', () => {
  let setup: Awaited<ReturnType<typeof createPracticeWithOwnerForTests>>;
  let n = 0;

  const cookie = () =>
    `${COOKIE_NAME}=${signUserToken({ userId: setup.user.id, practiceId: setup.practice.id, role: 'practice_owner' })}`;

  async function newClaim(opts: { payerType?: 'PRIVATE' | 'CDCP' | null; daysOutstanding?: number; queued?: boolean } = {}) {
    n += 1;
    const patientToken = piiVault.tokenize(
      { patientName: 'Test Patient', dateOfBirth: '1985-06-15', subscriberId: `SUB-${n}`, groupPolicyNumber: `GRP-${n}` },
      'dispatch_concurrency_test',
      setup.practice.id,
    );
    const claim = await prisma.insuranceClaim.create({
      data: {
        practiceId: setup.practice.id,
        carrierId: 'sun_life',
        claimNumber: `CLM-CONC-${n}-${Date.now()}`,
        patientToken,
        billedAmount: 250,
        outstandingAmount: 250,
        daysOutstanding: opts.daysOutstanding ?? 45,
        status: 'PENDING',
        payerType: opts.payerType === undefined ? 'PRIVATE' : opts.payerType,
      },
    });
    if (opts.queued !== false) {
      await prisma.callQueue.create({
        data: { practiceId: setup.practice.id, claimId: claim.id, scheduledFor: new Date(Date.now() - 1000), status: 'PENDING' },
      });
    }
    return claim;
  }

  const trigger = (claimId: string) =>
    request(app).post(`/api/insurance/queue/trigger/${claimId}`).set('Cookie', cookie());

  beforeAll(async () => {
    vi.stubEnv('VAPI_MAX_CONCURRENT_CALLS', '500');
    vi.stubEnv('VAPI_CONCURRENCY_RESERVE', '0');
    setup = await createPracticeWithOwnerForTests(prisma);
    const settings = defaultPracticeSettings();
    settings.voiceAgentEnabled = true;
    settings.carrierConfigs = settings.carrierConfigs.map((c) =>
      c.carrierId === 'sun_life'
        ? { ...c, authorizationSubmitted: true, providerNumber: `PN-CONC-${setup.practice.id.slice(0, 8)}` }
        : c,
    );
    await updatePracticeSettings(prisma, setup.practice.id, settings);
  }, 30_000);

  beforeEach(async () => {
    h.dials.length = 0;
    h.dialDelayMs = 0;
    h.triageGate = null;
    h.triageEntered = null;
    await prisma.queueEngineLease.deleteMany({ where: { id: 'global' } });
    await prisma.callAttempt.deleteMany({ where: { claim: { practiceId: setup.practice.id } } });
    await prisma.callQueue.deleteMany({ where: { practiceId: setup.practice.id } });
    await prisma.insuranceClaim.deleteMany({ where: { practiceId: setup.practice.id } });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(DISPATCH_TIME);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.queueEngineLease.deleteMany({ where: { id: 'global' } });
    await prisma.callAttempt.deleteMany({ where: { claim: { practiceId: setup.practice.id } } });
    await prisma.callQueue.deleteMany({ where: { practiceId: setup.practice.id } });
    await prisma.insuranceClaim.deleteMany({ where: { practiceId: setup.practice.id } });
    await prisma.practiceDeskState.deleteMany({ where: { practiceId: setup.practice.id } });
    await cleanupPracticeWithUsers(prisma, setup.practice.id);
  });

  async function stateOf(claimId: string) {
    const [attempts, queue, claim] = await Promise.all([
      prisma.callAttempt.findMany({ where: { claimId } }),
      prisma.callQueue.findUnique({ where: { claimId } }),
      prisma.insuranceClaim.findUnique({ where: { id: claimId } }),
    ]);
    return { attempts, queue, claim };
  }

  it('T4: parallel manual clicks on one claim dial exactly once', async () => {
    const claim = await newClaim();
    h.dialDelayMs = 80;
    const results = await Promise.all(Array.from({ length: 4 }, () => trigger(claim.id)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(h.dials.filter((d) => d.claimId === claim.id)).toHaveLength(1);
    const { attempts, queue } = await stateOf(claim.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].isHumanAssisted).toBe(true);
    expect(queue?.attempts).toBe(1);
    expect(h.dials[0].squadId).toBeTruthy();
  }, 30_000);

  it('T4: a scheduler tick after a manual click does not dial the claim again', async () => {
    const claim = await newClaim();
    expect((await trigger(claim.id)).status).toBe(200);
    await runDeskQueueTick(prisma);
    expect(h.dials.filter((d) => d.claimId === claim.id)).toHaveLength(1);
    expect((await stateOf(claim.id)).attempts).toHaveLength(1);
  }, 30_000);

  it('T4: a manual click after a scheduler dial is refused', async () => {
    const claim = await newClaim();
    await runDeskQueueTick(prisma);
    expect(h.dials.filter((d) => d.claimId === claim.id)).toHaveLength(1);
    const res = await trigger(claim.id);
    expect(res.status).toBe(422);
    expect(h.dials.filter((d) => d.claimId === claim.id)).toHaveLength(1);
  }, 30_000);

  it('T4: a manual click that finishes while the scheduler is mid-turn on the same claim leaves one dial', async () => {
    const claim = await newClaim();
    let release!: () => void;
    h.triageGate = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { h.triageEntered = resolve; });

    const tick = runDeskQueueTick(prisma);
    await entered; // the scheduler has loaded this claim and passed the guard
    h.triageEntered = null;
    expect((await trigger(claim.id)).status).toBe(200); // the manual click dials and completes
    release();
    await tick;

    expect(h.dials.filter((d) => d.claimId === claim.id)).toHaveLength(1);
    expect((await stateOf(claim.id)).attempts).toHaveLength(1);
  }, 30_000);

  it('a CDCP claim is refused by both paths with no dial, whatever the rollout flag says', async () => {
    const claim = await newClaim({ payerType: 'CDCP' });
    const manual = await trigger(claim.id);
    expect(manual.status).toBe(422);
    expect(manual.body.code).toBe('PAYER_PROGRAM_NOT_ENABLED');

    await prisma.featureFlag.create({
      data: { feature: 'dispatch.manual_shared_builder', paused: true, practiceId: setup.practice.id },
    });
    try {
      const pausedManual = await trigger(claim.id);
      expect(pausedManual.body.code).toBe('PAYER_PROGRAM_NOT_ENABLED');
      await runDeskQueueTick(prisma);
    } finally {
      await prisma.featureFlag.deleteMany({ where: { practiceId: setup.practice.id } });
    }
    expect(h.dials.filter((d) => d.claimId === claim.id)).toHaveLength(0);
    const { queue } = await stateOf(claim.id);
    expect(queue?.dispatchDeferralCode).toBe('PAYER_PROGRAM_NOT_ENABLED');
  }, 30_000);

  it('rollback: a paused flag stops manual dials for the practice, not the scheduler', async () => {
    const manualClaim = await newClaim({ queued: false });
    await prisma.featureFlag.create({
      data: { feature: 'dispatch.manual_shared_builder', paused: true, practiceId: setup.practice.id },
    });
    try {
      const res = await trigger(manualClaim.id);
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('MANUAL_DISPATCH_PAUSED');
      expect(h.dials).toHaveLength(0);
      expect((await stateOf(manualClaim.id)).claim?.status).toBe('PENDING');

      const scheduledClaim = await newClaim();
      await runDeskQueueTick(prisma);
      expect(h.dials.filter((d) => d.claimId === scheduledClaim.id)).toHaveLength(1);
    } finally {
      await prisma.featureFlag.deleteMany({ where: { practiceId: setup.practice.id } });
    }
  }, 30_000);

  it('treats an unclassified claim as PRIVATE and says so in the manual response', async () => {
    const claim = await newClaim({ payerType: null });
    const res = await trigger(claim.id);
    expect(res.status).toBe(200);
    expect(res.body.payerTypeAssumed).toBe(true);
    expect(res.body.executionMode).toBe('hold_sentinel');
  }, 30_000);

  it('an over-90 claim is dialed in Hold Sentinel mode when nothing else blocks it (DEC-2)', async () => {
    const claim = await newClaim({ daysOutstanding: 120 });
    const res = await trigger(claim.id);
    expect(res.status).toBe(200);
    expect(h.dials.filter((d) => d.claimId === claim.id)).toHaveLength(1);
  }, 30_000);

  it('a claim at the attempt cap is escalated with an open staff escalation, not marked resolved', async () => {
    const claim = await newClaim();
    await prisma.callQueue.update({ where: { claimId: claim.id }, data: { attempts: 3 } });
    const res = await trigger(claim.id);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('MAX_ATTEMPTS');
    const { claim: after, queue } = await stateOf(claim.id);
    expect(after?.status).toBe('ESCALATED');
    expect(queue?.status).toBe('ESCALATED');
    const escalations = await prisma.callEscalation.findMany({ where: { claimId: claim.id, status: 'open' } });
    expect(escalations).toHaveLength(1);
    expect(escalations[0].reason).toBe('Maximum automated call attempts reached');
    expect(h.dials).toHaveLength(0);
  }, 30_000);

  it('T5: recording the same dispatched call twice leaves one attempt row and keeps the human-assisted flag', async () => {
    const claim = await newClaim();
    await recordDispatchedCallAttempt(prisma, { claimId: claim.id, vapiCallId: 'vapi-replay-1', isHumanAssisted: false });
    await recordDispatchedCallAttempt(prisma, { claimId: claim.id, vapiCallId: 'vapi-replay-1', isHumanAssisted: true });
    await recordDispatchedCallAttempt(prisma, { claimId: claim.id, vapiCallId: 'vapi-replay-1', isHumanAssisted: true });
    const attempts = await prisma.callAttempt.findMany({ where: { claimId: claim.id } });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].isHumanAssisted).toBe(true);
  }, 30_000);
});
