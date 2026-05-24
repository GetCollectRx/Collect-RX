/**
 * Front desk (`deskRole: front_desk`) must not reach owner practice APIs.
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../../src/server/index.js';
import { COOKIE_NAME, signPracticeToken } from '../../src/server/authToken.js';
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

function deskCookie(practiceId: string): string {
  return `${COOKIE_NAME}=${signPracticeToken(practiceId, 'front_desk')}`;
}

function ownerCookie(practiceId: string): string {
  return `${COOKIE_NAME}=${signPracticeToken(practiceId, 'owner')}`;
}

describe.skipIf(!dbReady)('front_desk API gate', () => {
  it('returns 403 on owner routes and 200 on desk routes', async () => {
    const practice = await createPracticeForTests(prisma);
    const desk = deskCookie(practice.id);
    const owner = ownerCookie(practice.id);

    const blocked = await Promise.all([
      request(app).get('/api/insurance/claims').set('Cookie', desk),
      request(app).get('/api/dashboard/stats').set('Cookie', desk),
      request(app).get('/api/analytics/insurance').set('Cookie', desk),
      request(app).get('/api/work-queue').set('Cookie', desk),
      request(app).get('/api/calls').set('Cookie', desk),
      request(app).get('/api/carriers/health').set('Cookie', desk),
      request(app).get('/api/queue/carrier-order').set('Cookie', desk),
      request(app).get('/api/balances').set('Cookie', desk),
      request(app).get('/api/patients/balances').set('Cookie', desk),
    ]);

    for (const res of blocked) {
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/practice owner/i);
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

    await prisma.practice.delete({ where: { id: practice.id } });
  });
});
