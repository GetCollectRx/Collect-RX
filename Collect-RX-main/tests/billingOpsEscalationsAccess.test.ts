/**
 * Regression test for a false-positive "practiceId does not match session" 403
 * on GET /api/calls/:practiceId/escalations for the billing_ops_manager role.
 *
 * billing_ops_manager is a cross-practice reader with no fixed practiceId in its
 * session (JWT practiceId is ''); it must be allowed to pass any real practiceId
 * via the URL, same as platform_dev already is.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, prisma } from '../src/server/index.js';
import { COOKIE_NAME, signBriefSessionToken } from '../src/server/authToken.js';
import { createPracticeForTests, cleanupPracticeWithUsers } from './factories/practice.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn('[billingOpsEscalationsAccess] DATABASE_URL unreachable — tests skipped:', (e as Error).message);
}

let practice: { id: string; name: string };
let platformUserId: string;

async function setup() {
  practice = await createPracticeForTests(prisma);
  const passwordHash = await bcrypt.hash('fixture-pw', 4);
  const platformUser = await prisma.platformUser.create({
    data: {
      email: `billing-ops-${Date.now()}@fixture.test`,
      passwordHash,
      userRole: 'billing_ops_manager',
      practiceId: null,
    },
  });
  platformUserId = platformUser.id;
}

function billingOpsCookie(): string {
  const token = signBriefSessionToken({
    userRole: 'billing_ops_manager',
    userId: platformUserId,
    practiceId: null,
    phiAccess: false,
  });
  return `${COOKIE_NAME}=${token}`;
}

describe.skipIf(!dbReady)('billing_ops_manager cross-practice escalations access', () => {
  beforeAll(async () => {
    await setup();
  });

  afterAll(async () => {
    await prisma.platformUser.delete({ where: { id: platformUserId } }).catch(() => undefined);
    await cleanupPracticeWithUsers(prisma, practice.id);
    await prisma.$disconnect().catch(() => undefined);
  });

  it('does not 403 with "practiceId does not match session" when scoping to a real practice', async () => {
    const res = await request(app)
      .get(`/api/calls/${practice.id}/escalations`)
      .query({ status: 'open' })
      .set('Cookie', billingOpsCookie());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
