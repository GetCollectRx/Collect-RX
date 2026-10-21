import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const PRACTICE_A = '11111111-1111-4111-8111-111111111111';
const PRACTICE_B = '22222222-2222-4222-8222-222222222222';
const OLD_CALL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NEW_CALL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_PRACTICE_CALL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DONE_CALL = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

type Attempt = {
  id: string;
  vapiCallId: string;
  initiatedAt: Date;
  completedAt: Date | null;
  claim: { practiceId: string };
};

type Where = { id?: string; vapiCallId?: string; completedAt?: null; claim?: { practiceId?: string } };

const { state, prismaMock, transfer, updateAttempt, authState } = vi.hoisted(() => {
  const state = { attempts: [] as Attempt[] };
  const authState = { role: 'front_desk' as string, practiceId: '11111111-1111-4111-8111-111111111111' };
  const known = new Set(['id', 'vapiCallId', 'completedAt', 'claim']);

  // Applies only the filters the route is allowed to use; an unknown key fails the test
  // instead of silently widening the match.
  function matches(a: Attempt, where: Where): boolean {
    for (const key of Object.keys(where)) if (!known.has(key)) throw new Error(`unexpected where key ${key}`);
    if (where.id !== undefined && a.id !== where.id) return false;
    if (where.vapiCallId !== undefined && a.vapiCallId !== where.vapiCallId) return false;
    if (where.completedAt === null && a.completedAt !== null) return false;
    if (where.claim?.practiceId !== undefined && a.claim.practiceId !== where.claim.practiceId) return false;
    return true;
  }

  const updateAttempt = vi.fn(async () => ({}));
  const prismaMock = {
    callAttempt: {
      findFirst: vi.fn(async ({ where }: { where: Where }) => state.attempts.find((a) => matches(a, where)) ?? null),
      findMany: vi.fn(
        async ({ where, take }: { where: Where; take?: number }) =>
          state.attempts
            .filter((a) => matches(a, where))
            .sort((x, y) => y.initiatedAt.getTime() - x.initiatedAt.getTime())
            .slice(0, take),
      ),
      update: updateAttempt,
    },
    platformAdminPracticeGrant: { findUnique: vi.fn() },
  };
  return { state, prismaMock, transfer: vi.fn(), updateAttempt, authState };
});

vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../src/server/middleware/authenticate.js', () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { auth: unknown }).auth = {
      role: 'front_desk',
      userRole: authState.role,
      userId: 'user-1',
      practiceId: authState.practiceId,
      phiAccess: false,
    };
    next();
  },
}));
vi.mock('../src/vapi/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/vapi/client.js')>()),
  transferVapiCall: transfer,
  endVapiCall: vi.fn(),
}));
vi.mock('../src/server/audit/auditLog.js', () => ({ appendAuditLog: vi.fn() }));
vi.mock('../src/server/frontDesk/queueEngine.js', () => ({
  isPracticeQueuePaused: vi.fn(),
  setPracticeQueuePaused: vi.fn(),
}));
vi.mock('../src/server/frontDesk/carrierBlockService.js', () => ({ clearCarrierBlock: vi.fn() }));
vi.mock('../src/server/frontDesk/deskQueueBroadcast.js', () => ({ refreshDeskQueueBroadcast: vi.fn() }));
vi.mock('../src/server/frontDesk/deskWs.js', () => ({ broadcastDesk: vi.fn() }));
vi.mock('../src/server/services/escalationService.js', () => ({
  listEscalations: vi.fn(),
  resolveEscalation: vi.fn(),
}));
vi.mock('../src/server/frontDesk/claimFailureReview.js', () => ({ listMaxAttemptFailureReviews: vi.fn() }));
vi.mock('../src/server/recovery/holdLedger.js', () => ({ getPracticeHoldLedger: vi.fn() }));

import { createFrontDeskRouter } from '../src/server/routes/frontDeskApi.js';
import { VapiControlUnavailableError } from '../src/vapi/client.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/fd', createFrontDeskRouter());
  return a;
}

const takeover = (body: Record<string, unknown>, practiceId = PRACTICE_A) =>
  request(app()).post(`/fd/${practiceId}/active/takeover`).send(body);

const attempt = (id: string, practiceId: string, minutesAgo: number, completedAt: Date | null = null): Attempt => ({
  id,
  vapiCallId: `vapi-${id.slice(0, 4)}`,
  initiatedAt: new Date(Date.now() - minutesAgo * 60_000),
  completedAt,
  claim: { practiceId },
});

beforeEach(() => {
  vi.clearAllMocks();
  authState.role = 'front_desk';
  authState.practiceId = PRACTICE_A;
  transfer.mockResolvedValue(undefined);
  state.attempts = [
    attempt(OLD_CALL, PRACTICE_A, 30),
    attempt(NEW_CALL, PRACTICE_A, 5),
    attempt(OTHER_PRACTICE_CALL, PRACTICE_B, 1),
    attempt(DONE_CALL, PRACTICE_A, 90, new Date()),
  ];
});

describe('POST /:practiceId/active/takeover', () => {
  it('transfers the call staff selected, not the first active one', async () => {
    const res = await takeover({ phoneNumber: '+14165550101', callId: OLD_CALL });

    expect(res.status).toBe(200);
    expect(transfer).toHaveBeenCalledWith('vapi-aaaa', '+14165550101');
    expect(updateAttempt).toHaveBeenCalledWith(expect.objectContaining({ where: { id: OLD_CALL } }));
  });

  it('can target by Vapi call id', async () => {
    const res = await takeover({ phoneNumber: '+14165550101', vapiCallId: 'vapi-bbbb' });
    expect(res.status).toBe(200);
    expect(transfer).toHaveBeenCalledWith('vapi-bbbb', '+14165550101');
  });

  it('rejects a call that belongs to another practice, and neither transfers nor updates', async () => {
    const byId = await takeover({ phoneNumber: '+14165550101', callId: OTHER_PRACTICE_CALL });
    const byVapi = await takeover({ phoneNumber: '+14165550101', vapiCallId: 'vapi-cccc' });

    expect(byId.status).toBe(404);
    expect(byVapi.status).toBe(404);
    expect(transfer).not.toHaveBeenCalled();
    expect(updateAttempt).not.toHaveBeenCalled();
  });

  it('rejects a call that already ended', async () => {
    const res = await takeover({ phoneNumber: '+14165550101', callId: DONE_CALL });
    expect(res.status).toBe(404);
    expect(transfer).not.toHaveBeenCalled();
  });

  it('refuses to guess when several calls are live and none was selected', async () => {
    const res = await takeover({ phoneNumber: '+14165550101' });
    expect(res.status).toBe(409);
    expect(transfer).not.toHaveBeenCalled();
  });

  it('still works without a target when exactly one call is live', async () => {
    state.attempts = state.attempts.filter((a) => a.id !== OLD_CALL);
    const res = await takeover({ phoneNumber: '+14165550101' });
    expect(res.status).toBe(200);
    expect(transfer).toHaveBeenCalledWith('vapi-bbbb', '+14165550101');
  });

  it('returns 404 when nothing is live', async () => {
    state.attempts = [];
    expect((await takeover({ phoneNumber: '+14165550101' })).status).toBe(404);
  });

  it.each([
    ['a missing phone number', {}],
    ['a blank phone number', { phoneNumber: '   ' }],
    ['a non-uuid callId', { phoneNumber: '+14165550101', callId: 'not-an-id' }],
    ['both callId and vapiCallId', { phoneNumber: '+14165550101', callId: OLD_CALL, vapiCallId: 'vapi-aaaa' }],
  ])('returns 400 for %s', async (_label, body) => {
    expect((await takeover(body)).status).toBe(400);
    expect(transfer).not.toHaveBeenCalled();
  });

  it('keeps the call state untouched and answers 502 when the transfer cannot start', async () => {
    transfer.mockRejectedValue(new VapiControlUnavailableError('not_enabled'));
    const res = await takeover({ phoneNumber: '+14165550101', callId: NEW_CALL });

    expect(res.status).toBe(502);
    expect(updateAttempt).not.toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toMatch(/https?:\/\//);
  });

  it('answers 400 when the destination number is invalid', async () => {
    transfer.mockRejectedValue(new VapiControlUnavailableError('bad_destination'));
    expect((await takeover({ phoneNumber: '12345', callId: NEW_CALL })).status).toBe(400);
    expect(updateAttempt).not.toHaveBeenCalled();
  });

  it('is limited to front desk staff', async () => {
    authState.role = 'practice_owner';
    expect((await takeover({ phoneNumber: '+14165550101', callId: NEW_CALL })).status).toBe(403);
    expect(transfer).not.toHaveBeenCalled();
  });

  it('rejects a practiceId in the path that does not match the session', async () => {
    expect((await takeover({ phoneNumber: '+14165550101', callId: NEW_CALL }, PRACTICE_B)).status).toBe(403);
    expect(transfer).not.toHaveBeenCalled();
  });
});
