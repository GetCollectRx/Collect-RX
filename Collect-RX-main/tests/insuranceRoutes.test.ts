/**
 * src/routes/insurance.ts — route-level coverage (AA-32).
 *
 * cross-practice-idor.test.ts already covers IDOR/practice-scoping for the
 * GET/PATCH/confirm-payment/resolve-escalation endpoints. This file covers
 * the two highest-stakes endpoints that had zero HTTP-level coverage:
 *   - DELETE /claims/:id — soft delete, including the "call in progress" block
 *   - POST /queue/trigger/:claimId — dispatch guard rejections (claim not
 *     found, and the safety-rule guard denying dispatch before any Vapi call
 *     is ever placed — the default-settings VOICE_AGENT_DISABLED / BAAL gate)
 *
 * Full happy-path dispatch (through to a live Vapi call) is intentionally not
 * covered here — that requires mocking the Vapi client and is a larger,
 * separate piece of work.
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../src/server/index.js';
import { COOKIE_NAME, signUserToken } from '../src/server/authToken.js';
import { createPracticeWithOwnerForTests, cleanupPracticeWithUsers } from './factories/practice.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn(
    '[insuranceRoutes] DATABASE_URL unreachable — tests skipped:',
    (e as Error).message,
  );
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

function makeAuthCookie(userId: string, practiceId: string): string {
  return `${COOKIE_NAME}=${signUserToken({
    userId,
    practiceId,
    role: 'practice_owner',
  })}`;
}

async function createClaim(
  practiceId: string,
  overrides: Partial<{ daysOutstanding: number; status: string; carrierId: string }> = {},
) {
  return prisma.insuranceClaim.create({
    data: {
      practiceId,
      patientToken: crypto.randomUUID(),
      carrierId: (overrides.carrierId ?? 'sun_life') as never,
      claimNumber: `CLM-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      billedAmount: 1000,
      outstandingAmount: 1000,
      daysOutstanding: overrides.daysOutstanding ?? 45,
      status: (overrides.status ?? 'PENDING') as never,
      priority: 'NORMAL',
    },
  });
}

describe.skipIf(!dbReady)('src/routes/insurance.ts', () => {
  describe('DELETE /api/insurance/claims/:id', () => {
    it('soft-deletes a claim and excludes it from subsequent reads', async () => {
      const { practice, user } = await createPracticeWithOwnerForTests(prisma);
      const claim = await createClaim(practice.id);
      const cookie = makeAuthCookie(user.id, practice.id);

      const del = await request(app)
        .delete(`/api/insurance/claims/${claim.id}`)
        .set('Cookie', cookie);
      expect(del.status).toBe(200);
      expect(del.body.success).toBe(true);

      const stored = await prisma.insuranceClaim.findUnique({ where: { id: claim.id } });
      expect(stored?.deletedAt).not.toBeNull();

      const get = await request(app)
        .get(`/api/insurance/claims/${claim.id}`)
        .set('Cookie', cookie);
      expect(get.status).toBe(404);

      await cleanupPracticeWithUsers(prisma, practice.id);
    });

    it('blocks deletion while a call is actively in progress', async () => {
      const { practice, user } = await createPracticeWithOwnerForTests(prisma);
      const claim = await createClaim(practice.id, { status: 'CALLING' });
      const cookie = makeAuthCookie(user.id, practice.id);

      const del = await request(app)
        .delete(`/api/insurance/claims/${claim.id}`)
        .set('Cookie', cookie);
      expect(del.status).toBe(409);
      expect(del.body.success).toBe(false);

      const stored = await prisma.insuranceClaim.findUnique({ where: { id: claim.id } });
      expect(stored?.deletedAt).toBeNull();

      await cleanupPracticeWithUsers(prisma, practice.id);
    });

    it('returns 404 for a claim that does not exist in the caller practice', async () => {
      const { practice, user } = await createPracticeWithOwnerForTests(prisma);
      const cookie = makeAuthCookie(user.id, practice.id);

      const del = await request(app)
        .delete(`/api/insurance/claims/${crypto.randomUUID()}`)
        .set('Cookie', cookie);
      expect(del.status).toBe(404);

      await cleanupPracticeWithUsers(prisma, practice.id);
    });
  });

  describe('POST /api/insurance/queue/trigger/:claimId', () => {
    it('returns 404 for a claim that does not exist', async () => {
      const { practice, user } = await createPracticeWithOwnerForTests(prisma);
      const cookie = makeAuthCookie(user.id, practice.id);

      const res = await request(app)
        .post(`/api/insurance/queue/trigger/${crypto.randomUUID()}`)
        .set('Cookie', cookie);
      expect(res.status).toBe(404);

      await cleanupPracticeWithUsers(prisma, practice.id);
    });

    it('rejects dispatch via the safety guard without ever placing a call, for a practice with no carrier authorization on file', async () => {
      const { practice, user } = await createPracticeWithOwnerForTests(prisma);
      // Fresh practice: no PracticeSettings row → voiceAgentEnabled defaults
      // false, so checkCarrierAuthorizationGate() denies before any carrier
      // dial, exactly the BAAL/authorization gate this endpoint's own header
      // comment promises ("BAAL + provider number + voice agent enabled").
      const claim = await createClaim(practice.id, { daysOutstanding: 45 });
      const cookie = makeAuthCookie(user.id, practice.id);

      const res = await request(app)
        .post(`/api/insurance/queue/trigger/${claim.id}`)
        .set('Cookie', cookie);
      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('VOICE_AGENT_DISABLED');

      // Guard rejection must not have flipped the claim into CALLING state.
      const stored = await prisma.insuranceClaim.findUnique({ where: { id: claim.id } });
      expect(stored?.status).toBe('PENDING');

      await cleanupPracticeWithUsers(prisma, practice.id);
    });
  });

  describe('GET /api/insurance/queue', () => {
    it('returns a snapshot scoped to the caller practice only', async () => {
      const { practice: practiceA, user: userA } = await createPracticeWithOwnerForTests(prisma);
      const { practice: practiceB } = await createPracticeWithOwnerForTests(prisma);

      const claimA = await createClaim(practiceA.id);
      await prisma.callQueue.create({
        data: { practiceId: practiceA.id, claimId: claimA.id, scheduledFor: new Date(), status: 'PENDING' },
      });
      const claimB = await createClaim(practiceB.id);
      await prisma.callQueue.create({
        data: { practiceId: practiceB.id, claimId: claimB.id, scheduledFor: new Date(), status: 'PENDING' },
      });

      const cookieA = makeAuthCookie(userA.id, practiceA.id);
      const res = await request(app).get('/api/insurance/queue').set('Cookie', cookieA);
      expect(res.status).toBe(200);
      expect(res.body.snapshot.pending).toBe(1);
      expect(res.body.upcoming).toHaveLength(1);
      expect(res.body.upcoming[0].claim.claimNumber).toBe(claimA.claimNumber);

      await cleanupPracticeWithUsers(prisma, practiceA.id);
      await cleanupPracticeWithUsers(prisma, practiceB.id);
    });
  });
});
