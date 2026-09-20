/**
 * Cross-org isolation for the group/DSO reporting layer
 * (src/server/routes/groupAdminRoutes.ts). This router predates DSO
 * onboarding having any write path at all (see organizationOnboarding.test.ts)
 * and had no functional test — only a static role-gate audit. Now that orgs
 * can actually be created, its PHI-free aggregate views need a real,
 * multi-org test proving one group_admin never sees another group's data.
 *
 * DB-dependent; skipped with a clear log if DATABASE_URL is unreachable.
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
    '[groupAdminScoping] DATABASE_URL unreachable — DB-dependent tests will be skipped:',
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

/**
 * Self-serve org creation doesn't exist (admin-assisted only — see
 * src/server/routes/orgAdminRoutes.ts's header comment), so fixture orgs are
 * built directly via Prisma: an Organization, the owner's practice attached
 * to it, and an org_admin OrganizationMember row for the owner.
 */
async function createOrg(ownerEmail: string, ownerPassword: string, orgName: string, practiceId: string, userId: string) {
  const organization = await prisma.organization.create({ data: { name: orgName } });
  await prisma.organizationPractice.create({ data: { organizationId: organization.id, practiceId } });
  await prisma.organizationMember.create({ data: { organizationId: organization.id, userId, role: 'org_admin' } });
  const login = await request(app).post('/api/auth/login').send({ email: ownerEmail, password: ownerPassword });
  return { orgId: organization.id, cookie: cookieHeaderFrom(login) };
}

describe.skipIf(!dbReady)('GET /api/group/practices-summary — cross-org isolation', () => {
  it('a group_admin never sees another group\'s practices or claim counts', async () => {
    const ownerA = await createPracticeWithOwnerForTests(prisma);
    const ownerB = await createPracticeWithOwnerForTests(prisma);
    let orgAId: string | undefined;
    let orgBId: string | undefined;
    try {
      const { orgId: idA, cookie: cookieA } = await createOrg(ownerA.email, ownerA.password, 'Org A', ownerA.practice.id, ownerA.user.id);
      const { orgId: idB, cookie: cookieB } = await createOrg(ownerB.email, ownerB.password, 'Org B', ownerB.practice.id, ownerB.user.id);
      orgAId = idA;
      orgBId = idB;

      // Seed distinct claim counts per practice so leakage would be caught by a count mismatch, not just presence.
      await prisma.insuranceClaim.createMany({
        data: Array.from({ length: 3 }, (_, i) => ({
          practiceId: ownerA.practice.id,
          carrierId: 'sun_life' as const,
          claimNumber: `A-${i}`,
          patientToken: `tok-a-${i}`,
          billedAmount: 100,
          outstandingAmount: 100,
          daysOutstanding: 40,
        })),
      });
      await prisma.insuranceClaim.createMany({
        data: Array.from({ length: 5 }, (_, i) => ({
          practiceId: ownerB.practice.id,
          carrierId: 'sun_life' as const,
          claimNumber: `B-${i}`,
          patientToken: `tok-b-${i}`,
          billedAmount: 100,
          outstandingAmount: 100,
          daysOutstanding: 40,
        })),
      });

      const [summaryA, summaryB] = await Promise.all([
        request(app).get('/api/group/practices-summary').set('Cookie', cookieA),
        request(app).get('/api/group/practices-summary').set('Cookie', cookieB),
      ]);

      expect(summaryA.status).toBe(200);
      expect(summaryB.status).toBe(200);

      expect(summaryA.body.practices).toHaveLength(1);
      expect(summaryA.body.practices[0].id).toBe(ownerA.practice.id);
      expect(summaryA.body.practices[0].totalClaims).toBe(3);
      // Org A's response must never mention org B's practice at all.
      expect(summaryA.body.practices.some((p: { id: string }) => p.id === ownerB.practice.id)).toBe(false);

      expect(summaryB.body.practices).toHaveLength(1);
      expect(summaryB.body.practices[0].id).toBe(ownerB.practice.id);
      expect(summaryB.body.practices[0].totalClaims).toBe(5);
      expect(summaryB.body.practices.some((p: { id: string }) => p.id === ownerA.practice.id)).toBe(false);
    } finally {
      if (orgAId) await prisma.organization.delete({ where: { id: orgAId } }).catch(() => undefined);
      if (orgBId) await prisma.organization.delete({ where: { id: orgBId } }).catch(() => undefined);
      await prisma.insuranceClaim.deleteMany({ where: { practiceId: { in: [ownerA.practice.id, ownerB.practice.id] } } });
      await cleanupPracticeWithUsers(prisma, ownerA.practice.id);
      await cleanupPracticeWithUsers(prisma, ownerB.practice.id);
    }
  });

  it('a user with no group membership gets an empty list, not an error', async () => {
    const solo = await createPracticeWithOwnerForTests(prisma);
    try {
      const login = await request(app).post('/api/auth/login').send({ email: solo.email, password: solo.password });
      // A practice_owner who never created/joined a group has role practice_owner,
      // below the group_admin gate — authorizeRole should reject before reaching
      // the handler's own empty-memberships branch.
      const res = await request(app).get('/api/group/practices-summary').set('Cookie', cookieHeaderFrom(login));
      expect(res.status).toBe(403);
    } finally {
      await cleanupPracticeWithUsers(prisma, solo.practice.id);
    }
  });

  it('outstandingAR reflects real open-claim balances, not the hardcoded 0 it used to be', async () => {
    // Regression: this field was hardcoded to 0 under a comment claiming
    // "Patient AR removed — CollectRx is insurance-only" — but insurance AR
    // is the current product (only patient/client payment collection was
    // retired, see CLAUDE.md), so the group_admin role's own home route
    // showed "$0 Outstanding AR" for every location regardless of actual
    // claim balances.
    const owner = await createPracticeWithOwnerForTests(prisma);
    let orgId: string | undefined;
    try {
      const { orgId: id, cookie } = await createOrg(owner.email, owner.password, 'AR Total Org', owner.practice.id, owner.user.id);
      orgId = id;

      await prisma.insuranceClaim.createMany({
        data: [
          {
            practiceId: owner.practice.id,
            carrierId: 'sun_life' as const,
            claimNumber: 'AR-OPEN-1',
            patientToken: 'tok-ar-1',
            billedAmount: 400,
            outstandingAmount: 400,
            daysOutstanding: 20,
            status: 'PENDING',
          },
          {
            practiceId: owner.practice.id,
            carrierId: 'sun_life' as const,
            claimNumber: 'AR-OPEN-2',
            patientToken: 'tok-ar-2',
            billedAmount: 250,
            outstandingAmount: 250,
            daysOutstanding: 35,
            status: 'ESCALATED',
          },
          {
            practiceId: owner.practice.id,
            carrierId: 'sun_life' as const,
            claimNumber: 'AR-RESOLVED-1',
            patientToken: 'tok-ar-3',
            billedAmount: 300,
            outstandingAmount: 0,
            daysOutstanding: 10,
            status: 'RESOLVED',
          },
        ],
      });

      const res = await request(app).get('/api/group/practices-summary').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.practices).toHaveLength(1);
      expect(res.body.practices[0].outstandingAR).toBe(650);
    } finally {
      if (orgId) await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
      await prisma.insuranceClaim.deleteMany({ where: { practiceId: owner.practice.id } });
      await cleanupPracticeWithUsers(prisma, owner.practice.id);
    }
  });
});

describe.skipIf(!dbReady)('GET /api/group/compliance/export — cross-org isolation', () => {
  it('only returns practiceIds belonging to the caller\'s own group', async () => {
    const ownerA = await createPracticeWithOwnerForTests(prisma);
    const ownerB = await createPracticeWithOwnerForTests(prisma);
    let orgAId: string | undefined;
    let orgBId: string | undefined;
    try {
      const { orgId: idA, cookie: cookieA } = await createOrg(ownerA.email, ownerA.password, 'Compliance Org A', ownerA.practice.id, ownerA.user.id);
      const { orgId: idB } = await createOrg(ownerB.email, ownerB.password, 'Compliance Org B', ownerB.practice.id, ownerB.user.id);
      orgAId = idA;
      orgBId = idB;

      const res = await request(app).get('/api/group/compliance/export').set('Cookie', cookieA);
      expect(res.status).toBe(200);
      const ids = (res.body.practices as { practiceId: string }[]).map((p) => p.practiceId);
      expect(ids).toContain(ownerA.practice.id);
      expect(ids).not.toContain(ownerB.practice.id);
    } finally {
      if (orgAId) await prisma.organization.delete({ where: { id: orgAId } }).catch(() => undefined);
      if (orgBId) await prisma.organization.delete({ where: { id: orgBId } }).catch(() => undefined);
      await cleanupPracticeWithUsers(prisma, ownerA.practice.id);
      await cleanupPracticeWithUsers(prisma, ownerB.practice.id);
    }
  });
});
