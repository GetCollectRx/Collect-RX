/**
 * Front desk (`deskRole: front_desk`) must not reach owner practice APIs.
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../../src/server/index.js';
import { COOKIE_NAME, signUserToken } from '../../src/server/authToken.js';
import { createPracticeForTests } from '../factories/practice.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch {
  /* skip */
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

function cookieFor(userId: string, practiceId: string, role: 'front_desk' | 'practice_owner'): string {
  return `${COOKIE_NAME}=${signUserToken({ userId, practiceId, role })}`;
}

/**
 * Sessions are re-confirmed against the User row on every request, so these
 * must be real users in the practice — a token naming a user that does not
 * exist is rejected at authentication and never reaches the role gate.
 */
async function createUserForTests(
  practiceId: string,
  role: 'front_desk' | 'practice_owner',
): Promise<string> {
  const user = await prisma.user.create({
    data: {
      practiceId,
      email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@fixture.test`,
      passwordHash: 'not-used-in-this-test',
      role,
      displayName: `Fixture ${role}`,
    },
  });
  return user.id;
}

describe.skipIf(!dbReady)('front_desk API gate', () => {
  it('returns 403 on owner routes and 200 on desk routes', async () => {
    const practice = await createPracticeForTests(prisma);
    const deskUserId = await createUserForTests(practice.id, 'front_desk');
    const ownerUserId = await createUserForTests(practice.id, 'practice_owner');
    const desk = cookieFor(deskUserId, practice.id, 'front_desk');
    const owner = cookieFor(ownerUserId, practice.id, 'practice_owner');

    const blocked = await Promise.all([
      request(app).get('/api/insurance/claims').set('Cookie', desk),
      request(app).get('/api/dashboard/stats').set('Cookie', desk),
      request(app).get('/api/analytics/insurance').set('Cookie', desk),
      request(app).get('/api/work-queue').set('Cookie', desk),
      request(app).get('/api/calls').set('Cookie', desk),
      request(app).get('/api/carriers/health').set('Cookie', desk),
      request(app).get('/api/queue/carrier-order').set('Cookie', desk),
    ]);

    for (const res of blocked) {
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/practice owner/i);
    }

    // Patient billing APIs are retired — may 404/410 if unmounted, or 403 if hit behind the owner gate.
    const retired = await Promise.all([
      request(app).get('/api/balances').set('Cookie', desk),
      request(app).get('/api/patients/balances').set('Cookie', desk),
    ]);
    for (const res of retired) {
      expect([403, 404, 405, 410]).toContain(res.status);
      expect(res.status).not.toBe(200);
    }

    const deskQueue = await request(app)
      .get(`/api/desk/${practice.id}/queue`)
      .set('Cookie', desk);
    expect(deskQueue.status).toBe(200);
    expect(deskQueue.body.success).toBe(true);

    const ownerInsurance = await request(app)
      .get('/api/insurance/claims')
      .set('Cookie', owner);
    expect(ownerInsurance.status).not.toBe(403);

    await prisma.user.deleteMany({ where: { practiceId: practice.id } });
    await prisma.practice.delete({ where: { id: practice.id } });
  }, 30000);
});
