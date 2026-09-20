/**
 * DSO/Organization cross-org isolation for the co-admin invite path
 * (POST /api/auth/invite, role: 'group_admin' — src/server/routes/authRoutes.ts).
 *
 * Self-serve organization creation does not exist yet (admin-assisted only,
 * see src/server/routes/orgAdminRoutes.ts's own header comment — "Self-serve
 * org creation is a later phase"), so these tests build fixture
 * Organizations directly via Prisma rather than through an HTTP create route,
 * and focus on the real attack surface: an org_admin targeting a sibling
 * practice by id must be validated against their actual org membership
 * (callerAdminOrganizationId + OrganizationPractice), never trusted from the
 * request body.
 *
 * DB-dependent; skipped with a clear log if DATABASE_URL is unreachable (see
 * tests/app.integration.test.ts for the same pattern).
 */
import { describe, expect, it, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../src/server/index.js';
import { createPracticeWithOwnerForTests, cleanupPracticeWithUsers, FIXTURE_PRACTICE_PASSWORD } from './factories/practice.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn(
    '[organizationOnboarding] DATABASE_URL unreachable — DB-dependent tests will be skipped:',
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

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return cookieHeaderFrom(res);
}

/** Fixture: an Organization with one org_admin (group_admin User role) and one member practice. */
async function createOrgFixture(orgName: string) {
  const home = await createPracticeWithOwnerForTests(prisma, { role: 'group_admin' });
  const organization = await prisma.organization.create({ data: { name: orgName } });
  await prisma.organizationPractice.create({ data: { organizationId: organization.id, practiceId: home.practice.id } });
  await prisma.organizationMember.create({ data: { organizationId: organization.id, userId: home.user.id, role: 'org_admin' } });
  return { organization, admin: home };
}

async function cleanupOrgFixture(organizationId: string, practiceIds: string[]) {
  await prisma.inviteToken.deleteMany({ where: { organizationId } });
  await prisma.organizationMember.deleteMany({ where: { organizationId } });
  await prisma.organizationPractice.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
  for (const practiceId of practiceIds) {
    await cleanupPracticeWithUsers(prisma, practiceId);
  }
}

describe.skipIf(!dbReady)('POST /api/auth/invite — DSO co-admin / cross-org isolation', () => {
  it('a genuine org_admin can invite a co-admin targeting a sibling practice in their own org', async () => {
    const { organization: orgA, admin: adminA } = await createOrgFixture('Fixture Org A');
    const siblingA = await createPracticeWithOwnerForTests(prisma);
    await prisma.organizationPractice.create({ data: { organizationId: orgA.id, practiceId: siblingA.practice.id } });
    try {
      const cookie = await login(adminA.email, FIXTURE_PRACTICE_PASSWORD);
      const res = await request(app)
        .post('/api/auth/invite')
        .set('Cookie', cookie)
        .send({ email: `invitee-${Date.now()}@fixture.test`, role: 'group_admin', practiceId: siblingA.practice.id });

      expect(res.status).toBe(200);
    } finally {
      await cleanupOrgFixture(orgA.id, [adminA.practice.id, siblingA.practice.id]);
    }
  });

  it('rejects invite-practice from a GENUINE org_admin of a DIFFERENT org — the real IDOR case', async () => {
    const { organization: orgA, admin: adminA } = await createOrgFixture('Fixture Org A');
    const { organization: orgB, admin: adminB } = await createOrgFixture('Fixture Org B');
    try {
      const cookie = await login(adminA.email, FIXTURE_PRACTICE_PASSWORD);

      // adminA (org_admin of A) tries to target adminB's practice — which belongs to org B, not A.
      const res = await request(app)
        .post('/api/auth/invite')
        .set('Cookie', cookie)
        .send({ email: `attacker-target-${Date.now()}@fixture.test`, role: 'group_admin', practiceId: adminB.practice.id });

      expect(res.status).toBe(403);

      // No invite token was created for org B as a side effect of the attempt.
      const leaked = await prisma.inviteToken.findFirst({ where: { organizationId: orgB.id } });
      expect(leaked).toBeNull();
    } finally {
      await cleanupOrgFixture(orgA.id, [adminA.practice.id]);
      await cleanupOrgFixture(orgB.id, [adminB.practice.id]);
    }
  });

  it('rejects a co-admin invite from someone who is not an org_admin', async () => {
    const { organization: orgA, admin: adminA } = await createOrgFixture('Fixture Org A');
    // A plain practice_owner, not an org_admin of anything.
    const outsider = await createPracticeWithOwnerForTests(prisma);
    try {
      const cookie = await login(outsider.email, FIXTURE_PRACTICE_PASSWORD);
      const res = await request(app)
        .post('/api/auth/invite')
        .set('Cookie', cookie)
        .send({ email: `someone-${Date.now()}@fixture.test`, role: 'group_admin' });

      expect(res.status).toBe(403);
    } finally {
      await cleanupOrgFixture(orgA.id, [adminA.practice.id]);
      await cleanupPracticeWithUsers(prisma, outsider.practice.id);
    }
  });
});
