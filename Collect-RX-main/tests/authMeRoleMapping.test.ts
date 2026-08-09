/**
 * Regression for OUTSTANDING-FIXES-PRODUCT-READY.md P10-09.
 *
 * GET /api/auth/me computes a legacy `role` string from a PlatformUser's
 * `userRole` for the client's authRoleToBriefPersona() mapping. It previously
 * collapsed platform_admin into the same bucket as billing_ops_manager
 * ('group_admin'), which the client maps back to 'billing_ops_manager' —
 * silently demoting a platform_admin to a different role on every full page
 * load (any deep link, refresh, or bookmark), even though POST /api/auth/login
 * always computed this correctly for the same user. Locks a platform_admin
 * out of every admin screen without ever seeing a login failure.
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, prisma } from '../src/server/index.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn(
    '[authMeRoleMapping] DATABASE_URL unreachable — DB-dependent tests will be skipped:',
    (e as Error).message
  );
}

const FIXTURE_PASSWORD = 'test-platform-role-mapping-pw';
const createdIds: string[] = [];

afterAll(async () => {
  if (dbReady && createdIds.length) {
    await prisma.platformUser.deleteMany({ where: { id: { in: createdIds } } });
  }
  await prisma.$disconnect().catch(() => undefined);
});

async function createPlatformUser(userRole: 'platform_admin' | 'billing_ops_manager' | 'auditor') {
  const passwordHash = await bcrypt.hash(FIXTURE_PASSWORD, 4);
  const email = `role-mapping-${userRole}-${Date.now()}@fixture.test`;
  const user = await prisma.platformUser.create({
    data: { email, passwordHash, userRole, active: true },
  });
  createdIds.push(user.id);
  return { email, password: FIXTURE_PASSWORD };
}

(dbReady ? describe : describe.skip)('GET /api/auth/me — legacy role mapping for platform users', () => {
  it('reports platform_dev (not group_admin) for platform_admin, matching login', async () => {
    const { email, password } = await createPlatformUser('platform_admin');
    const agent = request.agent(app);

    const loginRes = await agent.post('/api/auth/login').send({ email, password });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.userRole).toBe('platform_admin');
    expect(loginRes.body.role).toBe('platform_dev');

    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.userRole).toBe('platform_admin');
    expect(meRes.body.role).toBe('platform_dev'); // was 'group_admin' before the fix
  });

  it('still reports group_admin for billing_ops_manager', async () => {
    const { email, password } = await createPlatformUser('billing_ops_manager');
    const agent = request.agent(app);

    await agent.post('/api/auth/login').send({ email, password });
    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.userRole).toBe('billing_ops_manager');
    expect(meRes.body.role).toBe('group_admin');
  });

  it('still reports accountant for auditor', async () => {
    const { email, password } = await createPlatformUser('auditor');
    const agent = request.agent(app);

    await agent.post('/api/auth/login').send({ email, password });
    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.userRole).toBe('auditor');
    expect(meRes.body.role).toBe('accountant');
  });
});
