/**
 * requirePracticeOwner (adminRoutes.ts's router-level gate) blocks only
 * front_desk sessions -- it does not require the literal practice_owner
 * role despite the name, so it was too permissive to also gate the
 * router's PUT routes with. practice_owner is marked isReadOnly: true /
 * canEditAdmin: false / canEditCarrierConfig: false in
 * src/lib/useRoleAccess.ts (and the parallel /settings page enforces
 * exactly that), but PUT /api/admin/practice-identity and PUT
 * /api/admin/settings both silently accepted writes from a practice_owner
 * session -- reproduced live via Playwright on /admin/integrations before
 * this fix. Only platform_dev and office_manager have canEditAdmin: true.
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../src/server/index.js';
import { createPracticeWithOwnerForTests, cleanupPracticeWithUsers } from './factories/practice.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn(
    '[adminRoutesWriteAuthorization] DATABASE_URL unreachable — skipping:',
    (e as Error).message,
  );
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

function cookieHeaderFrom(res: request.Response): string {
  const setCookie = res.headers['set-cookie'];
  return Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
}

(dbReady ? describe : describe.skip)('adminRoutes write endpoints — role enforcement', () => {
  it('practice_owner is rejected from PUT /api/admin/practice-identity and PUT /api/admin/settings', async () => {
    const owner = await createPracticeWithOwnerForTests(prisma, { role: 'practice_owner' });
    try {
      const login = await request(app).post('/api/auth/login').send({ email: owner.email, password: owner.password });
      expect(login.status).toBe(200);
      const cookie = cookieHeaderFrom(login);

      const identityRes = await request(app)
        .put('/api/admin/practice-identity')
        .set('Cookie', cookie)
        .send({ billingPhone: '+16135551234' });
      expect(identityRes.status).toBe(403);

      const settingsRes = await request(app)
        .put('/api/admin/settings')
        .set('Cookie', cookie)
        .send({ settings: { callWindowStart: '09:00' } });
      expect(settingsRes.status).toBe(403);

      // The role can still read this data — canViewAdmin: true for practice_owner.
      const getRes = await request(app).get('/api/admin/practice-identity').set('Cookie', cookie);
      expect(getRes.status).toBe(200);
    } finally {
      await cleanupPracticeWithUsers(prisma, owner.practice.id);
    }
  });

  it('office_manager can write to both endpoints (the fix must not lock out the intended editor)', async () => {
    const manager = await createPracticeWithOwnerForTests(prisma, { role: 'office_manager' });
    try {
      const login = await request(app).post('/api/auth/login').send({ email: manager.email, password: manager.password });
      expect(login.status).toBe(200);
      const cookie = cookieHeaderFrom(login);

      const identityRes = await request(app)
        .put('/api/admin/practice-identity')
        .set('Cookie', cookie)
        .send({ billingPhone: '+16135551234' });
      expect(identityRes.status).toBe(200);
      expect(identityRes.body).toEqual({ ok: true });

      const settingsRes = await request(app)
        .put('/api/admin/settings')
        .set('Cookie', cookie)
        .send({ settings: { callWindowStart: '09:00' } });
      expect(settingsRes.status).toBe(200);
      expect(settingsRes.body).toEqual({ ok: true });
    } finally {
      await cleanupPracticeWithUsers(prisma, manager.practice.id);
    }
  });
});
