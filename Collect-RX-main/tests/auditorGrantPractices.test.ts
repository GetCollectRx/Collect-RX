/**
 * Regression for OUTSTANDING-FIXES-PRODUCT-READY.md P10-13.
 *
 * isCrossPracticeReader() (accessControl/types.ts) only returns true for
 * billing_ops_manager/platform_admin — auditor was never included, even
 * though AuditorGrant exists specifically to scope which practices an
 * auditor can see (global via practiceId: null, or a named list) and is
 * already enforced on real data routes via assertAuditorPracticeGrant
 * (middleware/grantChecks.ts). That left a gap: an auditor with a real,
 * enforced grant still got back practices: [] from both POST /api/auth/login
 * and GET /api/auth/me, because neither ever queried AuditorGrant at all.
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, prisma } from '../src/server/index.js';
import { createPracticeForTests } from './factories/practice.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn(
    '[auditorGrantPractices] DATABASE_URL unreachable — DB-dependent tests will be skipped:',
    (e as Error).message,
  );
}

const FIXTURE_PASSWORD = 'test-auditor-grant-pw';
const createdUserIds: string[] = [];
const createdPracticeIds: string[] = [];

afterAll(async () => {
  if (dbReady) {
    await prisma.auditorGrant.deleteMany({ where: { auditorUserId: { in: createdUserIds } } });
    await prisma.platformUser.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.practice.deleteMany({ where: { id: { in: createdPracticeIds } } });
  }
  await prisma.$disconnect().catch(() => undefined);
});

async function createAuditor() {
  const passwordHash = await bcrypt.hash(FIXTURE_PASSWORD, 4);
  const email = `auditor-grant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@fixture.test`;
  const user = await prisma.platformUser.create({
    data: { email, passwordHash, userRole: 'auditor', active: true },
  });
  createdUserIds.push(user.id);
  return { user, email, password: FIXTURE_PASSWORD };
}

(dbReady ? describe : describe.skip)('GET/POST /api/auth/(login|me) — auditor practices reflect AuditorGrant', () => {
  it('a scoped grant returns exactly the granted practices, not none and not all', async () => {
    const { user, email, password } = await createAuditor();
    const granted = await createPracticeForTests(prisma);
    const notGranted = await createPracticeForTests(prisma);
    createdPracticeIds.push(granted.id, notGranted.id);
    await prisma.auditorGrant.create({ data: { auditorUserId: user.id, practiceId: granted.id } });

    const agent = request.agent(app);
    const loginRes = await agent.post('/api/auth/login').send({ email, password });
    expect(loginRes.status).toBe(200);
    const loginPracticeIds = (loginRes.body.practices as Array<{ id: string }>).map((p) => p.id);
    expect(loginPracticeIds).toEqual([granted.id]);
    expect(loginPracticeIds).not.toContain(notGranted.id);

    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    const mePracticeIds = (meRes.body.practices as Array<{ id: string }>).map((p) => p.id);
    expect(mePracticeIds).toEqual([granted.id]);
  });

  it('a global grant (practiceId: null) returns every practice', async () => {
    const { user, email, password } = await createAuditor();
    const practiceA = await createPracticeForTests(prisma);
    createdPracticeIds.push(practiceA.id);
    await prisma.auditorGrant.create({ data: { auditorUserId: user.id, practiceId: null } });

    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email, password });
    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    const mePracticeIds = (meRes.body.practices as Array<{ id: string }>).map((p) => p.id);
    expect(mePracticeIds).toContain(practiceA.id);
    expect(mePracticeIds.length).toBeGreaterThanOrEqual(1);
  });

  it('no grant at all returns an empty practices list, not an error', async () => {
    const { email, password } = await createAuditor();

    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email, password });
    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.practices).toEqual([]);
  });
});
