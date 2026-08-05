/**
 * DSO/Organization onboarding — POST /api/organizations, invite-practice,
 * and the consent-based accept flow. Every attach must originate from the
 * accepting practice's own owner session; an inviter must never be able to
 * attach a practice they don't own.
 *
 * DB-dependent; skipped with a clear log if DATABASE_URL is unreachable (see
 * tests/app.integration.test.ts for the same pattern).
 */
import { randomUUID } from 'node:crypto';
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

async function cleanupOrg(organizationId: string | null | undefined): Promise<void> {
  if (!organizationId) return;
  await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
}

describe.skipIf(!dbReady)('POST /api/organizations (create)', () => {
  it('creates a group, attaches the caller practice, and upgrades the caller to group_admin', async () => {
    const { practice, email, password, user } = await createPracticeWithOwnerForTests(prisma);
    let orgId: string | undefined;
    try {
      const cookie = await login(email, password);
      const createRes = await request(app)
        .post('/api/organizations')
        .set('Cookie', cookie)
        .send({ name: `Fixture Group ${Date.now()}` });
      expect(createRes.status).toBe(201);
      orgId = createRes.body.organization?.id;
      expect(orgId).toBeTruthy();

      const orgPractice = await prisma.organizationPractice.findUnique({ where: { practiceId: practice.id } });
      expect(orgPractice?.organizationId).toBe(orgId);

      const member = await prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: orgId!, userId: user.id } },
      });
      expect(member?.role).toBe('org_admin');

      const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
      expect(updatedUser?.role).toBe('group_admin');

      const mineRes = await request(app).get('/api/organizations/mine').set('Cookie', cookie);
      expect(mineRes.status).toBe(200);
      expect(mineRes.body.organizations).toHaveLength(1);
      expect(mineRes.body.organizations[0].practices).toEqual([{ id: practice.id, name: practice.name }]);
    } finally {
      await cleanupOrg(orgId);
      await cleanupPracticeWithUsers(prisma, practice.id);
    }
  });

  it('rejects creating a second group for a practice already in one', async () => {
    const { practice, email, password } = await createPracticeWithOwnerForTests(prisma);
    let orgId: string | undefined;
    try {
      const cookie = await login(email, password);
      const first = await request(app).post('/api/organizations').set('Cookie', cookie).send({ name: 'First Group' });
      orgId = first.body.organization?.id;

      const second = await request(app).post('/api/organizations').set('Cookie', cookie).send({ name: 'Second Group' });
      expect(second.status).toBe(409);
    } finally {
      await cleanupOrg(orgId);
      await cleanupPracticeWithUsers(prisma, practice.id);
    }
  });

  it('rejects a below-owner role from creating a group', async () => {
    const { practice, email, password } = await createPracticeWithOwnerForTests(prisma, { role: 'front_desk' });
    try {
      const cookie = await login(email, password);
      const res = await request(app).post('/api/organizations').set('Cookie', cookie).send({ name: 'Nope' });
      expect(res.status).toBe(403);
    } finally {
      await cleanupPracticeWithUsers(prisma, practice.id);
    }
  });
});

describe.skipIf(!dbReady)('invite-practice + consent-based accept', () => {
  it('lets the invited owner accept, and never lets the inviter attach the practice directly', async () => {
    const inviter = await createPracticeWithOwnerForTests(prisma);
    const invitee = await createPracticeWithOwnerForTests(prisma);
    let orgId: string | undefined;
    try {
      let inviterCookie = await login(inviter.email, inviter.password);
      const createRes = await request(app)
        .post('/api/organizations')
        .set('Cookie', inviterCookie)
        .send({ name: `Fixture DSO ${Date.now()}` });
      orgId = createRes.body.organization?.id;
      // The create response reissues the session cookie with role=group_admin
      // (see ensureGroupAdminRole) — must use the fresh cookie from here on,
      // exactly as a browser would apply the updated Set-Cookie automatically.
      inviterCookie = cookieHeaderFrom(createRes);

      const inviteRes = await request(app)
        .post(`/api/organizations/${orgId}/invite-practice`)
        .set('Cookie', inviterCookie)
        .send({ email: invitee.email });
      expect(inviteRes.status).toBe(200);
      expect(inviteRes.body.invited).toBe(true);

      // The inviter's own action never created the OrganizationPractice row for the invitee.
      const notYetAttached = await prisma.organizationPractice.findUnique({ where: { practiceId: invitee.practice.id } });
      expect(notYetAttached).toBeNull();

      const tokenRow = await prisma.organizationInviteToken.findFirst({
        where: { organizationId: orgId, inviteeEmail: invitee.email, usedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      expect(tokenRow).not.toBeNull();

      const previewRes = await request(app).get(`/api/organizations/invite/${tokenRow!.token}`);
      expect(previewRes.status).toBe(200);
      expect(previewRes.body.inviteeEmail).toBe(invitee.email);

      // A third party (not logged in as the invitee) can preview but not accept as themselves.
      const wrongPersonCookie = inviterCookie;
      const wrongAccept = await request(app)
        .post(`/api/organizations/invite/${tokenRow!.token}/accept`)
        .set('Cookie', wrongPersonCookie);
      expect(wrongAccept.status).toBe(403);

      const inviteeCookie = await login(invitee.email, invitee.password);
      const acceptRes = await request(app)
        .post(`/api/organizations/invite/${tokenRow!.token}/accept`)
        .set('Cookie', inviteeCookie);
      expect(acceptRes.status).toBe(200);
      expect(acceptRes.body.joined).toBe(true);

      const nowAttached = await prisma.organizationPractice.findUnique({ where: { practiceId: invitee.practice.id } });
      expect(nowAttached?.organizationId).toBe(orgId);

      const usedToken = await prisma.organizationInviteToken.findUnique({ where: { id: tokenRow!.id } });
      expect(usedToken?.usedAt).not.toBeNull();

      // Double-accept is rejected.
      const secondAccept = await request(app)
        .post(`/api/organizations/invite/${tokenRow!.token}/accept`)
        .set('Cookie', inviteeCookie);
      expect(secondAccept.status).toBe(410);
    } finally {
      await cleanupOrg(orgId);
      await cleanupPracticeWithUsers(prisma, inviter.practice.id);
      await cleanupPracticeWithUsers(prisma, invitee.practice.id);
    }
  });

  it('rejects invite-practice from someone who is not an admin of that group', async () => {
    const orgOwner = await createPracticeWithOwnerForTests(prisma);
    const outsider = await createPracticeWithOwnerForTests(prisma);
    let orgId: string | undefined;
    try {
      const ownerCookie = await login(orgOwner.email, orgOwner.password);
      const createRes = await request(app).post('/api/organizations').set('Cookie', ownerCookie).send({ name: 'Owned Group' });
      orgId = createRes.body.organization?.id;

      const outsiderCookie = await login(outsider.email, outsider.password);
      const res = await request(app)
        .post(`/api/organizations/${orgId}/invite-practice`)
        .set('Cookie', outsiderCookie)
        .send({ email: 'someone@fixture.test' });
      expect(res.status).toBe(403);
    } finally {
      await cleanupOrg(orgId);
      await cleanupPracticeWithUsers(prisma, orgOwner.practice.id);
      await cleanupPracticeWithUsers(prisma, outsider.practice.id);
    }
  });

  it('rejects invite-practice from a GENUINE group_admin of a DIFFERENT org — the real IDOR case', async () => {
    // The "not an admin" test above uses an outsider who never holds
    // group_admin role at all, so it only proves authorizeRole('group_admin')
    // rejects them — it never reaches (and never proved correct) the
    // isOrgAdminMember() membership check inside the handler. This is the
    // adversarial case that actually exercises it: the attacker legitimately
    // owns their OWN org (so they genuinely hold group_admin role) and tries
    // to invite a practice into a DIFFERENT org they don't belong to.
    const orgAOwner = await createPracticeWithOwnerForTests(prisma);
    const orgBOwner = await createPracticeWithOwnerForTests(prisma);
    let orgAId: string | undefined;
    let orgBId: string | undefined;
    try {
      const ownerACookie = await login(orgAOwner.email, orgAOwner.password);
      const createA = await request(app).post('/api/organizations').set('Cookie', ownerACookie).send({ name: 'Org A' });
      orgAId = createA.body.organization?.id;

      const ownerBCookie = await login(orgBOwner.email, orgBOwner.password);
      const createB = await request(app).post('/api/organizations').set('Cookie', ownerBCookie).send({ name: 'Org B' });
      orgBId = createB.body.organization?.id;
      // The fresh session cookie reissued on create carries the real group_admin role.
      const attackerCookie = cookieHeaderFrom(createB);

      const res = await request(app)
        .post(`/api/organizations/${orgAId}/invite-practice`)
        .set('Cookie', attackerCookie)
        .send({ email: 'someone@fixture.test' });
      expect(res.status).toBe(403);

      // No invite token was created for org A as a side effect of the rejected attempt.
      const leaked = await prisma.organizationInviteToken.findFirst({ where: { organizationId: orgAId } });
      expect(leaked).toBeNull();
    } finally {
      await cleanupOrg(orgAId);
      await cleanupOrg(orgBId);
      await cleanupPracticeWithUsers(prisma, orgAOwner.practice.id);
      await cleanupPracticeWithUsers(prisma, orgBOwner.practice.id);
    }
  });

  it('rejects an expired invite and an already-in-a-group practice trying to accept', async () => {
    const orgOwner = await createPracticeWithOwnerForTests(prisma);
    const alreadyGrouped = await createPracticeWithOwnerForTests(prisma);
    let orgId: string | undefined;
    let otherOrgId: string | undefined;
    try {
      let ownerCookie = await login(orgOwner.email, orgOwner.password);
      const createRes = await request(app).post('/api/organizations').set('Cookie', ownerCookie).send({ name: 'Group A' });
      orgId = createRes.body.organization?.id;
      ownerCookie = cookieHeaderFrom(createRes);

      // Expired token, never accepted.
      const expiredToken = randomUUID();
      await prisma.organizationInviteToken.create({
        data: {
          organizationId: orgId!,
          inviteeEmail: 'nobody@fixture.test',
          token: expiredToken,
          expiresAt: new Date(Date.now() - 60_000),
          createdBy: 'system',
        },
      });
      const expiredPreview = await request(app).get(`/api/organizations/invite/${expiredToken}`);
      expect(expiredPreview.status).toBe(410);

      // alreadyGrouped's own group — trying to accept an invite into Group A should 409.
      const otherCookie = await login(alreadyGrouped.email, alreadyGrouped.password);
      const otherOrgRes = await request(app).post('/api/organizations').set('Cookie', otherCookie).send({ name: 'Group B' });
      otherOrgId = otherOrgRes.body.organization?.id;

      const inviteRes = await request(app)
        .post(`/api/organizations/${orgId}/invite-practice`)
        .set('Cookie', ownerCookie)
        .send({ email: alreadyGrouped.email });
      const tokenRow = await prisma.organizationInviteToken.findFirst({
        where: { organizationId: orgId, inviteeEmail: alreadyGrouped.email, usedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      expect(inviteRes.status).toBe(200);

      const acceptRes = await request(app)
        .post(`/api/organizations/invite/${tokenRow!.token}/accept`)
        .set('Cookie', otherCookie);
      expect(acceptRes.status).toBe(409);
    } finally {
      await cleanupOrg(orgId);
      await cleanupOrg(otherOrgId);
      await cleanupPracticeWithUsers(prisma, orgOwner.practice.id);
      await cleanupPracticeWithUsers(prisma, alreadyGrouped.practice.id);
    }
  });
});
