/**
 * Regression test for the same false-positive "practiceId does not match session" 403
 * that affected GET /api/calls/:practiceId/escalations for billing_ops_manager, but on
 * the sibling per-practice report routes, which share the same conflict-checking
 * function (queryPracticeConflictsSession).
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
  console.warn('[billingOpsReportsAccess] DATABASE_URL unreachable — tests skipped:', (e as Error).message);
}

let practice: { id: string; name: string };
let platformUserId: string;

async function setup() {
  practice = await createPracticeForTests(prisma);
  const passwordHash = await bcrypt.hash('fixture-pw', 4);
  const platformUser = await prisma.platformUser.create({
    data: {
      email: `billing-ops-reports-${Date.now()}@fixture.test`,
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

describe.skipIf(!dbReady)('billing_ops_manager cross-practice report access', () => {
  beforeAll(async () => {
    await setup();
  });

  afterAll(async () => {
    await prisma.platformUser.delete({ where: { id: platformUserId } }).catch(() => undefined);
    await cleanupPracticeWithUsers(prisma, practice.id);
    await prisma.$disconnect().catch(() => undefined);
  });

  it('does not 403 on GET /api/practices/:practiceId/reports/aging', async () => {
    const res = await request(app)
      .get(`/api/practices/${practice.id}/reports/aging`)
      .set('Cookie', billingOpsCookie());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('does not 403 on GET /api/practices/:practiceId/reports/carriers', async () => {
    const res = await request(app)
      .get(`/api/practices/${practice.id}/reports/carriers`)
      .set('Cookie', billingOpsCookie());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('does not 403 on GET /api/practices/:practiceId/reports/queue', async () => {
    const res = await request(app)
      .get(`/api/practices/${practice.id}/reports/queue`)
      .set('Cookie', billingOpsCookie());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
