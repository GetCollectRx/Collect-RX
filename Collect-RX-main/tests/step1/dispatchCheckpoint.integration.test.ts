/**
 * DEC-9 (b): staff checkpoint at first use per practice and carrier.
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
  const end = async () => {
  };
  return {
    ...actual,
    initiateCall: dial,
    endVapiCall: end,
    vapiClient: { ...actual.vapiClient, initiateCall: dial, endVapiCall: end },
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
const { evaluateDispatchCheckpoint } = await import('../../src/server/frontDesk/dispatchCheckpoint.js');
const { createPracticeWithOwnerForTests, cleanupPracticeWithUsers } = await import('../factories/practice.js');
const { defaultPracticeSettings, updatePracticeSettings } = await import(
  '../../src/server/services/practiceSettingsService.js'
);
const { piiVault } = await import('../../src/pii-vault.js');
const { COOKIE_NAME, signUserToken } = await import('../../src/server/authToken.js');

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

describe.skipIf(!dbReady)('DEC-9 (b) checkpoint (real Postgres)', () => {
  let setup: Awaited<ReturnType<typeof createPracticeWithOwnerForTests>>;
  let other: Awaited<ReturnType<typeof createPracticeWithOwnerForTests>>;
  let n = 0;

  const cookie = () =>
    `${COOKIE_NAME}=${signUserToken({ userId: setup.user.id, practiceId: setup.practice.id, role: 'practice_owner' })}`;

  async function newClaim() {
    n += 1;
    const patientToken = piiVault.tokenize(
      { patientName: 'Test Patient', dateOfBirth: '1985-06-15', subscriberId: `SUB-${n}`, groupPolicyNumber: `GRP-${n}` },
      'dispatch_checkpoint_test',
      setup.practice.id,
    );
    const claim = await prisma.insuranceClaim.create({
      data: {
        practiceId: setup.practice.id,
        carrierId: 'sun_life',
        claimNumber: `CLM-CKPT-${n}-${Date.now()}`,
        patientToken,
        billedAmount: 250,
        outstandingAmount: 250,
        daysOutstanding: 45,
        status: 'PENDING',
        payerType: 'PRIVATE',
      },
    });
    await prisma.callQueue.create({
      data: { practiceId: setup.practice.id, claimId: claim.id, scheduledFor: new Date(Date.now() - 1000), status: 'PENDING' },
    });
    return claim;
  }

  const trigger = (claimId: string) =>
    request(app).post(`/api/insurance/queue/trigger/${claimId}`).set('Cookie', cookie());
  const decide = (id: string, body: Record<string, unknown>) =>
    request(app).post(`/api/dispatch-checkpoints/${id}/decision`).set('Cookie', cookie()).send(body);

  async function enforce(practiceId: string) {
    await prisma.featureFlag.create({
      data: { practiceId, feature: 'dispatch.approval_checkpoint', paused: false },
    });
  }

  async function wipe() {
    for (const p of [setup, other]) {
      await prisma.dispatchCheckpoint.deleteMany({ where: { practiceId: p.practice.id } });
      await prisma.featureFlag.deleteMany({ where: { practiceId: p.practice.id, feature: 'dispatch.approval_checkpoint' } });
    }
    await prisma.queueEngineLease.deleteMany({ where: { id: 'global' } });
    await prisma.callAttempt.deleteMany({ where: { claim: { practiceId: setup.practice.id } } });
    await prisma.callQueue.deleteMany({ where: { practiceId: setup.practice.id } });
    await prisma.insuranceClaim.deleteMany({ where: { practiceId: setup.practice.id } });
  }

  beforeAll(async () => {
    vi.stubEnv('VAPI_MAX_CONCURRENT_CALLS', '500');
    vi.stubEnv('VAPI_CONCURRENCY_RESERVE', '0');
    setup = await createPracticeWithOwnerForTests(prisma);
    other = await createPracticeWithOwnerForTests(prisma);
    const settings = defaultPracticeSettings();
    settings.voiceAgentEnabled = true;
    settings.carrierConfigs = settings.carrierConfigs.map((c) =>
      c.carrierId === 'sun_life'
        ? { ...c, authorizationSubmitted: true, providerNumber: `PN-CKPT-${setup.practice.id.slice(0, 8)}` }
        : c,
    );
    await updatePracticeSettings(prisma, setup.practice.id, settings);
  }, 30_000);

  beforeEach(async () => {
    h.dials.length = 0;
    h.dialDelayMs = 0;
    h.triageGate = null;
    h.triageEntered = null;
    await wipe();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(DISPATCH_TIME);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await wipe();
    await prisma.practiceDeskState.deleteMany({ where: { practiceId: setup.practice.id } });
    await cleanupPracticeWithUsers(prisma, setup.practice.id);
    await cleanupPracticeWithUsers(prisma, other.practice.id);
  });

  it('is not enforced while the flag is off: nothing is created and the call goes out', async () => {
    const claim = await newClaim();
    expect((await trigger(claim.id)).status).toBe(200);
    expect(h.dials).toHaveLength(1);
    expect(await prisma.dispatchCheckpoint.count({ where: { practiceId: setup.practice.id } })).toBe(0);
  }, 30_000);

  it('manual: refuses before approval, requests the checkpoint once, and never dials', async () => {
    await enforce(setup.practice.id);
    const claim = await newClaim();
    const results = await Promise.all(Array.from({ length: 4 }, () => trigger(claim.id)));
    for (const r of results) {
      expect(r.status).toBe(422);
      expect(r.body.code).toBe('PENDING_DISPATCH_APPROVAL');
    }
    expect(h.dials).toHaveLength(0);
    const checkpoints = await prisma.dispatchCheckpoint.findMany({ where: { practiceId: setup.practice.id } });
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]).toMatchObject({ carrierId: 'sun_life', status: 'PENDING' });
    const events = await prisma.dispatchCheckpointEvent.findMany({ where: { checkpointId: checkpoints[0].id } });
    expect(events.map((e) => e.action)).toEqual(['REQUESTED']);
  }, 30_000);

  it('scheduler: parks the entry without counting an attempt, then dials after approval', async () => {
    await enforce(setup.practice.id);
    const claim = await newClaim();
    await runDeskQueueTick(prisma);
    expect(h.dials).toHaveLength(0);
    const parked = await prisma.callQueue.findUnique({ where: { claimId: claim.id } });
    expect(parked).toMatchObject({ status: 'PENDING', attempts: 0, dispatchDeferralCode: 'PENDING_DISPATCH_APPROVAL' });

    const checkpoint = await prisma.dispatchCheckpoint.findFirstOrThrow({ where: { practiceId: setup.practice.id } });
    const approved = await decide(checkpoint.id, { decision: 'APPROVED', notes: 'Reviewed carrier setup' });
    expect(approved.status).toBe(200);

    const released = await prisma.callQueue.findUnique({ where: { claimId: claim.id } });
    expect(released?.dispatchDeferralCode).toBeNull();
    await prisma.queueEngineLease.deleteMany({ where: { id: 'global' } });
    await runDeskQueueTick(prisma);
    expect(h.dials.filter((d) => d.claimId === claim.id)).toHaveLength(1);
  }, 30_000);

  it('manual dials once the carrier is approved, and revoking stops both paths again', async () => {
    await enforce(setup.practice.id);
    const first = await newClaim();
    expect((await trigger(first.id)).status).toBe(422);
    const checkpoint = await prisma.dispatchCheckpoint.findFirstOrThrow({ where: { practiceId: setup.practice.id } });
    expect((await decide(checkpoint.id, { decision: 'APPROVED' })).status).toBe(200);
    expect((await trigger(first.id)).status).toBe(200);

    expect((await decide(checkpoint.id, { decision: 'REVOKED', notes: 'Pausing while we review' })).status).toBe(200);
    const second = await newClaim();
    const refused = await trigger(second.id);
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('PENDING_DISPATCH_APPROVAL');
    await runDeskQueueTick(prisma);
    expect(h.dials.filter((d) => d.claimId === second.id)).toHaveLength(0);

    const events = await prisma.dispatchCheckpointEvent.findMany({
      where: { checkpointId: checkpoint.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.action)).toEqual(['REQUESTED', 'APPROVED', 'REVOKED']);
    expect(events[1].actorUserId).toBe(setup.user.id);
  }, 30_000);

  it('an approval covers one carrier for one practice only', async () => {
    await enforce(setup.practice.id);
    await enforce(other.practice.id);
    await evaluateDispatchCheckpoint(prisma, setup.practice.id, 'sun_life');
    const checkpoint = await prisma.dispatchCheckpoint.findFirstOrThrow({ where: { practiceId: setup.practice.id } });
    await decide(checkpoint.id, { decision: 'APPROVED' });

    expect((await evaluateDispatchCheckpoint(prisma, setup.practice.id, 'sun_life')).allowed).toBe(true);
    expect((await evaluateDispatchCheckpoint(prisma, setup.practice.id, 'manulife')).allowed).toBe(false);
    expect((await evaluateDispatchCheckpoint(prisma, other.practice.id, 'sun_life')).allowed).toBe(false);
  }, 30_000);

  it('the decision API validates input and does not reach another practice\'s checkpoint', async () => {
    await enforce(other.practice.id);
    await evaluateDispatchCheckpoint(prisma, other.practice.id, 'sun_life');
    const theirs = await prisma.dispatchCheckpoint.findFirstOrThrow({ where: { practiceId: other.practice.id } });
    expect((await decide(theirs.id, { decision: 'APPROVED' })).status).toBe(404);
    expect((await prisma.dispatchCheckpoint.findUniqueOrThrow({ where: { id: theirs.id } })).status).toBe('PENDING');
    expect((await decide(theirs.id, { decision: 'MAYBE' })).status).toBe(400);
  }, 30_000);

  it('only the practice owner can read or decide: every other role gets 403 and nothing changes', async () => {
    await enforce(setup.practice.id);
    await evaluateDispatchCheckpoint(prisma, setup.practice.id, 'sun_life');
    const checkpoint = await prisma.dispatchCheckpoint.findFirstOrThrow({ where: { practiceId: setup.practice.id } });
    for (const role of ['office_manager', 'billing_coordinator', 'front_desk', 'accountant', 'associate_dentist'] as const) {
      const cookieFor = `${COOKIE_NAME}=${signUserToken({ userId: setup.user.id, practiceId: setup.practice.id, role })}`;
      const read = await request(app).get('/api/dispatch-checkpoints').set('Cookie', cookieFor);
      const write = await request(app)
        .post(`/api/dispatch-checkpoints/${checkpoint.id}/decision`)
        .set('Cookie', cookieFor)
        .send({ decision: 'APPROVED' });
      const history = await request(app).get(`/api/dispatch-checkpoints/${checkpoint.id}/history`).set('Cookie', cookieFor);
      expect([role, read.status, write.status, history.status]).toEqual([role, 403, 403, 403]);
    }
    expect((await prisma.dispatchCheckpoint.findUniqueOrThrow({ where: { id: checkpoint.id } })).status).toBe('PENDING');
  }, 30_000);

  it('history lists decisions newest first with the deciding user, and stays inside the practice', async () => {
    await enforce(setup.practice.id);
    await enforce(other.practice.id);
    await evaluateDispatchCheckpoint(prisma, setup.practice.id, 'sun_life');
    await evaluateDispatchCheckpoint(prisma, other.practice.id, 'sun_life');
    const mine = await prisma.dispatchCheckpoint.findFirstOrThrow({ where: { practiceId: setup.practice.id } });
    const theirs = await prisma.dispatchCheckpoint.findFirstOrThrow({ where: { practiceId: other.practice.id } });
    await decide(mine.id, { decision: 'APPROVED', notes: 'Reviewed' });
    await decide(mine.id, { decision: 'REVOKED' });

    const res = await request(app).get(`/api/dispatch-checkpoints/${mine.id}/history`).set('Cookie', cookie());
    expect(res.status).toBe(200);
    expect(res.body.data.map((e: { action: string }) => e.action)).toEqual(['REVOKED', 'APPROVED', 'REQUESTED']);
    expect(res.body.data[1]).toMatchObject({ actorName: setup.user.displayName, notes: 'Reviewed' });
    expect(res.body.data[2].actorName).toBeNull();

    expect((await request(app).get(`/api/dispatch-checkpoints/${theirs.id}/history`).set('Cookie', cookie())).status).toBe(404);
  }, 30_000);

  it('the audit trail rejects updates and deletes at the database', async () => {
    await enforce(setup.practice.id);
    await evaluateDispatchCheckpoint(prisma, setup.practice.id, 'sun_life');
    const event = await prisma.dispatchCheckpointEvent.findFirstOrThrow({ where: { practiceId: setup.practice.id } });
    await expect(prisma.dispatchCheckpointEvent.update({ where: { id: event.id }, data: { notes: 'edited' } })).rejects.toThrow();
    await expect(prisma.dispatchCheckpointEvent.delete({ where: { id: event.id } })).rejects.toThrow();
  }, 30_000);
});
