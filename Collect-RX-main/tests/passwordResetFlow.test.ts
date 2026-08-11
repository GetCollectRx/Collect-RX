/**
 * Password reset flow — request issues a PasswordResetToken, confirm consumes it.
 *
 * DB-dependent; skipped with a clear log if DATABASE_URL is unreachable (see
 * tests/app.integration.test.ts for the same pattern).
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
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
    '[passwordResetFlow] DATABASE_URL unreachable — DB-dependent tests will be skipped:',
    (e as Error).message,
  );
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

describe.skipIf(!dbReady)('POST /api/auth/reset-password/request + /confirm', () => {
  it('issues a token on request and consumes it on confirm, allowing login with the new password', async () => {
    const { practice, user, email } = await createPracticeWithOwnerForTests(prisma);
    try {
      // The DB only ever stores hashResetToken(rawToken) — see authRoutes.ts's
      // POST /reset-password/request. The raw token that actually redeems a
      // reset is never persisted, only delivered to the user (here, via the
      // structured logger.info(..., { resetUrl }) console fallback used when
      // SENDGRID_API_KEY is unset). Spy on it to recover the raw token the
      // same way an emailed link would.
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const requestRes = await request(app)
        .post('/api/auth/reset-password/request')
        .send({ email });
      const loggedLine = consoleLogSpy.mock.calls
        .map((args) => args.join(' '))
        .find((line) => line.includes('resetUrl'));
      consoleLogSpy.mockRestore();
      expect(requestRes.status).toBe(200);
      expect(requestRes.body.ok).toBe(true);

      const tokenRow = await prisma.passwordResetToken.findFirst({
        where: { userId: user.id, usedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      expect(tokenRow).not.toBeNull();
      expect(tokenRow!.expiresAt.getTime()).toBeGreaterThan(Date.now());

      expect(loggedLine, 'expected password-reset console fallback to have logged the reset URL').toBeDefined();
      const match = loggedLine!.match(/token=([0-9a-f]+)/);
      expect(match, 'expected reset URL to contain a hex token query param').not.toBeNull();
      const rawToken = decodeURIComponent(match![1]);

      const newPassword = 'brand-new-password-123';
      const confirmRes = await request(app)
        .post('/api/auth/reset-password/confirm')
        .send({ token: rawToken, newPassword });
      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.ok).toBe(true);

      const usedRow = await prisma.passwordResetToken.findUnique({ where: { id: tokenRow!.id } });
      expect(usedRow?.usedAt).not.toBeNull();

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email, password: newPassword });
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.practice?.id).toBe(practice.id);
    } finally {
      await cleanupPracticeWithUsers(prisma, practice.id);
    }
  });

  it('returns 200 without creating a token for an unknown email (anti-enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password/request')
      .send({ email: 'no-such-user-reset-flow@fixture.test' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('rejects confirm with an expired token', async () => {
    const { practice, user } = await createPracticeWithOwnerForTests(prisma);
    try {
      const token = `expired-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await prisma.passwordResetToken.create({
        data: { userId: user.id, token, expiresAt: new Date(Date.now() - 60_000) },
      });

      const res = await request(app)
        .post('/api/auth/reset-password/confirm')
        .send({ token, newPassword: 'whatever-password-1' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid or expired/i);

      // password must not have changed
      const stillOldHash = await prisma.user.findUnique({ where: { id: user.id } });
      expect(stillOldHash?.passwordHash).toBe(user.passwordHash);
    } finally {
      await cleanupPracticeWithUsers(prisma, practice.id);
    }
  });

  it('rejects confirm with an already-used token', async () => {
    const { practice, user } = await createPracticeWithOwnerForTests(prisma);
    try {
      const token = `used-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          token,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          usedAt: new Date(),
        },
      });

      const res = await request(app)
        .post('/api/auth/reset-password/confirm')
        .send({ token, newPassword: 'whatever-password-2' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid or expired/i);
    } finally {
      await cleanupPracticeWithUsers(prisma, practice.id);
    }
  });

  it('rejects confirm with an invalid/unknown token', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password/confirm')
      .send({ token: 'this-token-does-not-exist', newPassword: 'whatever-password-3' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or expired/i);
  });

  it('rejects confirm with a too-short new password', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password/confirm')
      .send({ token: 'irrelevant-token', newPassword: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/8 characters/i);
  });
});
