/**
 * Staff invite flow — POST /api/auth/invite -> GET /api/auth/invite/:token ->
 * POST /api/auth/accept-invite, exercising real InviteToken consumption.
 *
 * DB-dependent; skipped with a clear log if DATABASE_URL is unreachable (see
 * tests/app.integration.test.ts for the same pattern).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { PracticeRole } from '@prisma/client';
import { app, prisma } from '../src/server/index.js';
import { createPracticeWithOwnerForTests, cleanupPracticeWithUsers } from './factories/practice.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn(
    '[acceptInviteFlow] DATABASE_URL unreachable — DB-dependent tests will be skipped:',
    (e as Error).message,
  );
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

function inviteeEmail(): string {
  return `invitee-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@fixture.test`;
}

function cookieHeaderFrom(res: request.Response): string {
  const setCookie = res.headers['set-cookie'];
  return Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
}

describe.skipIf(!dbReady)('POST /api/auth/invite + GET /invite/:token + POST /accept-invite', () => {
  it('practice owner invites, the token is fetchable, and accept-invite creates a working account', async () => {
    const { practice, email, password } = await createPracticeWithOwnerForTests(prisma);
    const invitedEmail = inviteeEmail();
    try {
      const loginRes = await request(app).post('/api/auth/login').send({ email, password });
      expect(loginRes.status).toBe(200);
      const cookie = cookieHeaderFrom(loginRes);

      const inviteRes = await request(app)
        .post('/api/auth/invite')
        .set('Cookie', cookie)
        .send({ email: invitedEmail, role: 'front_desk' });
      expect(inviteRes.status).toBe(200);
      expect(inviteRes.body.invited).toBe(true);

      const tokenRow = await prisma.inviteToken.findFirst({
        where: { practiceId: practice.id, email: invitedEmail, usedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      expect(tokenRow).not.toBeNull();
      expect(tokenRow!.expiresAt.getTime()).toBeGreaterThan(Date.now());

      const lookupRes = await request(app).get(`/api/auth/invite/${tokenRow!.token}`);
      expect(lookupRes.status).toBe(200);
      expect(lookupRes.body.email).toBe(invitedEmail);
      expect(lookupRes.body.role).toBe('front_desk');
      expect(lookupRes.body.practiceName).toBe(practice.name);

      const acceptRes = await request(app)
        .post('/api/auth/accept-invite')
        .send({ token: tokenRow!.token, displayName: 'Invited Person', password: 'invited-password-123' });
      expect(acceptRes.status).toBe(201);
      expect(acceptRes.body.role).toBe('front_desk');
      expect(acceptRes.body.user?.email).toBe(invitedEmail);

      const usedRow = await prisma.inviteToken.findUnique({ where: { id: tokenRow!.id } });
      expect(usedRow?.usedAt).not.toBeNull();

      const newUserLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: invitedEmail, password: 'invited-password-123' });
      expect(newUserLogin.status).toBe(200);
    } finally {
      await prisma.user.deleteMany({ where: { email: invitedEmail } });
      await cleanupPracticeWithUsers(prisma, practice.id);
    }
  });

  it('rejects lookup and accept for an expired invite token', async () => {
    const { practice } = await createPracticeWithOwnerForTests(prisma);
    const invitedEmail = inviteeEmail();
    try {
      const token = randomUUID();
      await prisma.inviteToken.create({
        data: {
          practiceId: practice.id,
          email: invitedEmail,
          role: 'front_desk' as PracticeRole,
          token,
          expiresAt: new Date(Date.now() - 60_000),
        },
      });

      const lookupRes = await request(app).get(`/api/auth/invite/${token}`);
      expect(lookupRes.status).toBe(410);

      const acceptRes = await request(app)
        .post('/api/auth/accept-invite')
        .send({ token, displayName: 'Nope', password: 'whatever-password-1' });
      expect(acceptRes.status).toBe(410);

      const stillNoUser = await prisma.user.findUnique({ where: { email: invitedEmail } });
      expect(stillNoUser).toBeNull();
    } finally {
      await cleanupPracticeWithUsers(prisma, practice.id);
    }
  });

  it('rejects lookup and accept for an already-used invite token', async () => {
    const { practice } = await createPracticeWithOwnerForTests(prisma);
    const invitedEmail = inviteeEmail();
    try {
      const token = randomUUID();
      await prisma.inviteToken.create({
        data: {
          practiceId: practice.id,
          email: invitedEmail,
          role: 'front_desk' as PracticeRole,
          token,
          expiresAt: new Date(Date.now() + 60_000),
          usedAt: new Date(),
        },
      });

      const lookupRes = await request(app).get(`/api/auth/invite/${token}`);
      expect(lookupRes.status).toBe(410);

      const acceptRes = await request(app)
        .post('/api/auth/accept-invite')
        .send({ token, displayName: 'Nope', password: 'whatever-password-2' });
      expect(acceptRes.status).toBe(410);
    } finally {
      await cleanupPracticeWithUsers(prisma, practice.id);
    }
  });

  it('rejects lookup and accept for an invalid/unknown invite token', async () => {
    const unknownToken = randomUUID();
    const lookupRes = await request(app).get(`/api/auth/invite/${unknownToken}`);
    expect(lookupRes.status).toBe(404);

    const acceptRes = await request(app)
      .post('/api/auth/accept-invite')
      .send({ token: unknownToken, displayName: 'Nope', password: 'whatever-password-3' });
    expect(acceptRes.status).toBe(404);
  });
});
