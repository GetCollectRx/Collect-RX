/**
 * Live Console actions (takeover, pause, end call) must act on the call staff
 * are looking at. With two calls open, the routes used to take whichever open
 * attempt the database returned first, so "Take Over" could put staff on a
 * different patient's call.
 *
 * Real app, real Postgres, synthetic claims. Vapi is stubbed at fetch: no call
 * leaves the process.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../../src/server/index.js';
import { COOKIE_NAME, signUserToken } from '../../src/server/authToken.js';
import { runWithRlsBypass } from '../../src/server/db/rlsContext.js';
import { cleanupPracticeWithUsers, createPracticeForTests, createUserForTests } from '../factories/practice.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn('[liveConsoleCallSelection.integration] DATABASE_URL unreachable, tests skipped:', (e as Error).message);
}

const savedKey = process.env.VAPI_API_KEY;
const controlUrl = (vapiCallId: string): string => `https://sim-control.vapi.ai/${vapiCallId}/control`;
let controlPosts: Array<{ vapiCallId: string; type: string }> = [];

function stubVapi(): void {
  controlPosts = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const getCall = /^https:\/\/api\.vapi\.ai\/call\/([^/]+)$/u.exec(url);
    if (getCall && (init?.method ?? 'GET') === 'GET') {
      const id = getCall[1] ?? '';
      return new Response(JSON.stringify({ id, status: 'in-progress', monitor: { controlUrl: controlUrl(id) } }), { status: 200 });
    }
    const control = /^https:\/\/sim-control\.vapi\.ai\/([^/]+)\/control$/u.exec(url);
    if (control && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { type: string };
      controlPosts.push({ vapiCallId: control[1] ?? '', type: body.type });
      return new Response('{}', { status: 200 });
    }
    return new Response('not stubbed', { status: 599 });
  });
}

describe.skipIf(!dbReady)('Live Console acts on the selected call', () => {
  let practiceId = '';
  let otherPracticeId = '';
  let desk = '';
  let older = { id: '', vapiCallId: '' };
  let newer = { id: '', vapiCallId: '' };
  let foreign = { id: '', vapiCallId: '' };
  const claimIds: string[] = [];

  async function openCall(pid: string, suffix: string, initiatedAt: Date): Promise<{ id: string; vapiCallId: string }> {
    const claim = await runWithRlsBypass(() =>
      prisma.insuranceClaim.create({
        data: {
          practiceId: pid,
          carrierId: 'sun_life',
          claimNumber: `SEL-${suffix}-${Date.now()}`,
          patientToken: `00000000-0000-4000-8000-${String(claimIds.length + 1).padStart(12, '0')}`,
          billedAmount: '100.00',
          outstandingAmount: '100.00',
          daysOutstanding: 40,
        },
      }),
    );
    claimIds.push(claim.id);
    const vapiCallId = `sel-${suffix}-${claim.id.slice(0, 8)}`;
    const attempt = await runWithRlsBypass(() =>
      prisma.callAttempt.create({ data: { claimId: claim.id, vapiCallId, initiatedAt, liveState: 'on_hold' } }),
    );
    return { id: attempt.id, vapiCallId };
  }

  beforeAll(async () => {
    process.env.VAPI_API_KEY = 'vapi-selection-test-placeholder';
    const practice = await createPracticeForTests(prisma);
    const other = await createPracticeForTests(prisma);
    practiceId = practice.id;
    otherPracticeId = other.id;
    const deskUser = await createUserForTests(prisma, practiceId, 'front_desk');
    desk = `${COOKIE_NAME}=${signUserToken({ userId: deskUser.id, practiceId, role: 'front_desk' })}`;
    // The console shows the newest call (GET /active orders by initiatedAt desc).
    // The older call is created first so it is the row an unordered query is
    // most likely to return: the old routes' failure mode.
    older = await openCall(practiceId, 'old', new Date(Date.now() - 60_000));
    newer = await openCall(practiceId, 'new', new Date());
    foreign = await openCall(otherPracticeId, 'foreign', new Date());
  });

  beforeEach(() => stubVapi());
  afterEach(() => vi.unstubAllGlobals());

  afterAll(async () => {
    if (savedKey === undefined) delete process.env.VAPI_API_KEY;
    else process.env.VAPI_API_KEY = savedKey;
    await runWithRlsBypass(async () => {
      await prisma.callAttempt.deleteMany({ where: { claimId: { in: claimIds } } });
      await prisma.insuranceClaim.deleteMany({ where: { id: { in: claimIds } } });
    });
    await cleanupPracticeWithUsers(prisma, practiceId);
    await cleanupPracticeWithUsers(prisma, otherPracticeId);
    await prisma.$disconnect().catch(() => undefined);
  });

  const post = (action: string, body: Record<string, unknown>) =>
    request(app).post(`/api/desk/${practiceId}/active/${action}`).set('Cookie', desk).send(body);

  it('the console shows the newest open call', async () => {
    const res = await request(app).get(`/api/desk/${practiceId}/active`).set('Cookie', desk);
    expect(res.status).toBe(200);
    expect(res.body.data.call.id).toBe(newer.id);
  });

  it('takes over the selected call, every time, whichever call is selected', async () => {
    for (const selected of [newer, newer, older, newer]) {
      const before = controlPosts.length;
      const res = await post('takeover', { callId: selected.id, phoneNumber: '+16135550150' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(controlPosts.slice(before)).toEqual([{ vapiCallId: selected.vapiCallId, type: 'transfer' }]);
    }
    const rows = await runWithRlsBypass(() =>
      prisma.callAttempt.findMany({ where: { id: { in: [older.id, newer.id] } }, select: { id: true, takenOverByStaffAt: true } }),
    );
    expect(rows.every((r) => r.takenOverByStaffAt !== null)).toBe(true);
  });

  it('pauses only the selected call, whichever call is selected', async () => {
    const states = async (): Promise<Record<string, string | null>> => {
      const rows = await runWithRlsBypass(() =>
        prisma.callAttempt.findMany({ where: { id: { in: [older.id, newer.id] } }, select: { id: true, liveState: true } }),
      );
      return Object.fromEntries(rows.map((r) => [r.id, r.liveState]));
    };
    const reset = () =>
      runWithRlsBypass(() =>
        prisma.callAttempt.updateMany({ where: { id: { in: [older.id, newer.id] } }, data: { pausedByStaffAt: null, liveState: 'on_hold' } }),
      );
    for (const [selected, untouched] of [[newer, older], [older, newer]] as const) {
      await reset();
      const res = await post('pause-agent', { callId: selected.id });
      expect(res.status).toBe(200);
      expect(await states()).toEqual({ [selected.id]: 'paused_by_staff', [untouched.id]: 'on_hold' });
    }
  });

  it('ends only the selected call, whichever call is selected', async () => {
    for (const selected of [newer, older]) {
      const res = await post('end-call', { callId: selected.id });
      expect(res.status).toBe(200);
    }
    expect(controlPosts).toEqual([
      { vapiCallId: newer.vapiCallId, type: 'end-call' },
      { vapiCallId: older.vapiCallId, type: 'end-call' },
    ]);
  });

  it('refuses to guess when several calls are open and none is named', async () => {
    for (const [action, body] of [
      ['takeover', { phoneNumber: '+16135550150' }],
      ['pause-agent', {}],
      ['end-call', {}],
    ] as const) {
      const res = await post(action, body);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CALL_ID_REQUIRED');
    }
    expect(controlPosts).toEqual([]);
  });

  it('never acts on another practice\'s call, a finished call or a malformed id', async () => {
    const cross = await post('takeover', { callId: foreign.id, phoneNumber: '+16135550150' });
    expect(cross.status).toBe(404);
    for (const bad of ['', '   ', 42, 'x'.repeat(65)]) {
      const res = await post('end-call', { callId: bad });
      expect(res.status).toBe(400);
    }
    expect(controlPosts).toEqual([]);
  });

  it('still works without an id when exactly one call is open', async () => {
    await runWithRlsBypass(() => prisma.callAttempt.update({ where: { id: older.id }, data: { completedAt: new Date() } }));
    const finished = await post('end-call', { callId: older.id });
    expect(finished.status).toBe(404);

    const res = await post('end-call', {});
    expect(res.status).toBe(200);
    expect(controlPosts).toEqual([{ vapiCallId: newer.vapiCallId, type: 'end-call' }]);
  });
});
