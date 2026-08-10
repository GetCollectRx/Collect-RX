/**
 * Session revocation — a token must stop working the moment the underlying
 * user is deactivated or moved to another practice.
 *
 * The JWT carries `practiceId` and is valid for 8h (90d for accountants), so
 * without a per-request DB check a deactivated user keeps full PHI access for
 * the remainder of that TTL. Deactivation is the mechanism staff use when
 * someone leaves the practice, so the gap between "revoked in the UI" and
 * "revoked in effect" is the window that matters under PHIPA.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../src/server/index.js';
import { COOKIE_NAME, signUserToken } from '../src/server/authToken.js';
import { clearSessionSubjectCache } from '../src/server/accessControl/sessionSubject.js';
import { createPracticeWithOwnerForTests, cleanupPracticeWithUsers } from './factories/practice.js';

// These tests revoke access by writing to the DB directly, which does not go
// through the route handlers that call invalidateSessionSubject(). Clearing the
// cache stands in for that hook so the assertions test the revocation logic
// rather than the cache TTL.
function revoked(): void {
  clearSessionSubjectCache();
}

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn('[sessionRevocation] DATABASE_URL unreachable — tests skipped:', (e as Error).message);
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

let practiceA: Awaited<ReturnType<typeof createPracticeWithOwnerForTests>>;
let practiceB: Awaited<ReturnType<typeof createPracticeWithOwnerForTests>>;

function cookieFor(userId: string, practiceId: string, role: 'practice_owner' | 'accountant' = 'practice_owner'): string {
  return `${COOKIE_NAME}=${signUserToken({ userId, practiceId, role })}`;
}

describe.skipIf(!dbReady)('Session revocation', () => {
  beforeAll(async () => {
    practiceA = await createPracticeWithOwnerForTests(prisma);
    practiceB = await createPracticeWithOwnerForTests(prisma);
  });

  afterAll(async () => {
    await cleanupPracticeWithUsers(prisma, practiceA.practice.id);
    await cleanupPracticeWithUsers(prisma, practiceB.practice.id);
  });

  it('accepts a live session for an active user', async () => {
    await prisma.user.update({
      where: { id: practiceA.user.id },
      data: { isActive: true },
    });
    revoked();
    const res = await request(app)
      .get('/api/insurance/claims')
      .set('Cookie', cookieFor(practiceA.user.id, practiceA.practice.id));
    expect(res.status).toBe(200);
  });

  it('rejects a still-valid token once the user is deactivated', async () => {
    const cookie = cookieFor(practiceA.user.id, practiceA.practice.id);

    await prisma.user.update({
      where: { id: practiceA.user.id },
      data: { isActive: false },
    });
    revoked();

    const res = await request(app).get('/api/insurance/claims').set('Cookie', cookie);
    expect(res.status).toBe(401);

    await prisma.user.update({
      where: { id: practiceA.user.id },
      data: { isActive: true },
    });
    revoked();
  });

  it('rejects a token whose practiceId does not match the user record', async () => {
    // Same shape as a stale token held after staff moved the user to another
    // location: correctly signed, but no longer describes where the user works.
    const cookie = cookieFor(practiceA.user.id, practiceB.practice.id);
    const res = await request(app).get('/api/insurance/claims').set('Cookie', cookie);
    expect(res.status).toBe(401);
  });

  it('rejects a deleted user still holding a signed token', async () => {
    const temp = await createPracticeWithOwnerForTests(prisma);
    const cookie = cookieFor(temp.user.id, temp.practice.id);

    const ok = await request(app).get('/api/insurance/claims').set('Cookie', cookie);
    expect(ok.status).toBe(200);

    await cleanupPracticeWithUsers(prisma, temp.practice.id);
    revoked();

    const res = await request(app).get('/api/insurance/claims').set('Cookie', cookie);
    expect(res.status).toBe(401);
  });
});
