/**
 * Phase 2 self-serve DSO onboarding — self-serve org signup, co-admin
 * invites, and the batch PMS import API, all driven through the real HTTP
 * API (same pattern as tests/orgAdminRoutes.test.ts for the admin-assisted
 * Phase 1 flow).
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../src/server/index.js';
import { createPracticeForTests, createPracticeWithOwnerForTests, cleanupPracticeWithUsers } from './factories/practice.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch {
  /* skip */
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

function extractCookie(res: request.Response): string {
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie ?? '');
  const match = raw.match(/crx_access=[^;]+/);
  return match?.[0] ?? '';
}

const csvRows = (claimNumber: string) => [{
  claim_number: claimNumber,
  patient_first_name: 'Jane',
  patient_last_name: 'Doe',
  carrier_name: 'Sun Life',
  treatment_date: '2026-02-15',
  amount_billed: '450.00',
  amount_outstanding: '450.00',
  days_outstanding: '45',
  treatment_codes: 'D1110',
  patient_dob: '1985-06-12',
}];

describe.skipIf(!dbReady)('Self-serve org signup → co-admin invite → batch PMS import', () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  let organizationId: string | undefined;
  let practiceIds: string[] = [];
  let ownerUserId: string | undefined;
  let ownerCookie = '';
  let coAdminUserId: string | undefined;
  let outsidePracticeId: string | undefined;
  let siblingInviteUserId: string | undefined;

  let convertedUserId: string | undefined;
  let convertedPracticeId: string | undefined;
  let convertedOrganizationId: string | undefined;

  afterAll(async () => {
    for (const practiceId of practiceIds) {
      await prisma.pmsImportRun.deleteMany({ where: { practiceId } });
      await prisma.insuranceClaim.deleteMany({ where: { practiceId } });
    }
    if (ownerUserId) await prisma.user.deleteMany({ where: { id: ownerUserId } });
    if (coAdminUserId) await prisma.user.deleteMany({ where: { id: coAdminUserId } });
    if (siblingInviteUserId) await prisma.user.deleteMany({ where: { id: siblingInviteUserId } });
    if (organizationId) {
      await prisma.organizationMember.deleteMany({ where: { organizationId } });
      await prisma.organizationPractice.deleteMany({ where: { organizationId } });
      await prisma.inviteToken.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
    }
    if (practiceIds.length) {
      // The sibling-practice staff invite is practice-scoped, not org-scoped
      // (organizationId is null), so it isn't caught by the org-scoped cleanup above.
      await prisma.inviteToken.deleteMany({ where: { practiceId: { in: practiceIds } } });
      await prisma.practice.deleteMany({ where: { id: { in: practiceIds } } });
    }
    if (outsidePracticeId) {
      await prisma.practice.delete({ where: { id: outsidePracticeId } }).catch(() => undefined);
    }
    if (convertedUserId) await prisma.user.deleteMany({ where: { id: convertedUserId } });
    if (convertedOrganizationId) {
      await prisma.organizationMember.deleteMany({ where: { organizationId: convertedOrganizationId } });
      await prisma.organizationPractice.deleteMany({ where: { organizationId: convertedOrganizationId } });
      await prisma.organization.delete({ where: { id: convertedOrganizationId } }).catch(() => undefined);
    }
    if (convertedPracticeId) {
      await prisma.practice.delete({ where: { id: convertedPracticeId } }).catch(() => undefined);
    }
  });

  it('self-serve register creates an org with N practices and a group_admin owner', async () => {
    const registerRes = await request(app).post('/api/auth/register').send({
      practiceName: `Fixture Location A ${suffix}`,
      displayName: 'Fixture Owner',
      email: `dso-owner-${suffix}@fixture.test`,
      password: 'fixture-dso-owner-pw',
      organizationName: `Fixture Self-Serve DSO ${suffix}`,
      additionalPractices: [{ practiceName: `Fixture Location B ${suffix}` }],
      carriers: [{ carrierId: 'sun_life', providerNumber: 'ON-FIXTURE-1' }],
      privacyPolicyAccepted: true,
    });

    expect(registerRes.status).toBe(201);
    expect(registerRes.body.role).toBe('group_admin');
    organizationId = registerRes.body.organizationId;
    ownerUserId = registerRes.body.user.id;
    expect(organizationId).toBeDefined();

    ownerCookie = extractCookie(registerRes);
    const me = await request(app).get('/api/auth/me').set('Cookie', ownerCookie);
    expect(me.status).toBe(200);
    practiceIds = (me.body.practices as Array<{ id: string }>).map((p) => p.id);
    expect(practiceIds.length).toBe(2);

    const membership = await prisma.organizationMember.findFirst({
      where: { organizationId, userId: ownerUserId },
    });
    expect(membership?.role).toBe('org_admin');
  });

  it('a single-practice signup (no additionalPractices) is unchanged: practice_owner, no organization', async () => {
    const registerRes = await request(app).post('/api/auth/register').send({
      practiceName: `Fixture Solo Practice ${suffix}`,
      displayName: 'Solo Owner',
      email: `solo-owner-${suffix}@fixture.test`,
      password: 'fixture-solo-owner-pw',
      carriers: [{ carrierId: 'manulife', providerNumber: 'ON-FIXTURE-2' }],
      privacyPolicyAccepted: true,
    });

    expect(registerRes.status).toBe(201);
    expect(registerRes.body.role).toBe('practice_owner');
    expect(registerRes.body.organizationId).toBeUndefined();

    await prisma.user.deleteMany({ where: { id: registerRes.body.user.id } });
    await prisma.practice.delete({ where: { id: registerRes.body.practiceId } }).catch(() => undefined);
  });

  it('registration requires at least one carrier and Privacy Policy acceptance', async () => {
    const base = {
      practiceName: `Fixture Rejects ${suffix}`,
      displayName: 'Rejected Owner',
      password: 'fixture-rejected-owner-pw',
    };

    const noCarriers = await request(app).post('/api/auth/register').send({
      ...base,
      email: `no-carriers-${suffix}@fixture.test`,
      carriers: [],
      privacyPolicyAccepted: true,
    });
    expect(noCarriers.status).toBe(400);

    const noConsent = await request(app).post('/api/auth/register').send({
      ...base,
      email: `no-consent-${suffix}@fixture.test`,
      carriers: [{ carrierId: 'sun_life', providerNumber: 'ON-FIXTURE-3' }],
      privacyPolicyAccepted: false,
    });
    expect(noConsent.status).toBe(400);
  });

  it('registration records selected carriers as authorized and stamps privacy policy consent', async () => {
    const email = `carrier-consent-${suffix}@fixture.test`;
    const registerRes = await request(app).post('/api/auth/register').send({
      practiceName: `Fixture Carrier Consent ${suffix}`,
      displayName: 'Carrier Consent Owner',
      email,
      password: 'fixture-carrier-consent-pw',
      carriers: [
        { carrierId: 'sun_life', providerNumber: 'ON-FIXTURE-4' },
        { carrierId: 'manulife', providerNumber: 'ON-FIXTURE-5' },
      ],
      privacyPolicyAccepted: true,
    });
    expect(registerRes.status).toBe(201);

    const practiceId = registerRes.body.practiceId as string;
    const practice = await prisma.practice.findUniqueOrThrow({ where: { id: practiceId } });
    expect(practice.privacyPolicyAcceptedAt).not.toBeNull();
    expect(practice.privacyPolicyVersion).toBeTruthy();

    const settings = practice.settings as { carrierConfigs: Array<{ carrierId: string; enabled: boolean; providerNumber: string }> };
    const sunLife = settings.carrierConfigs.find((c) => c.carrierId === 'sun_life');
    const manulife = settings.carrierConfigs.find((c) => c.carrierId === 'manulife');
    const greenShield = settings.carrierConfigs.find((c) => c.carrierId === 'green_shield');
    expect(sunLife).toMatchObject({ enabled: true, providerNumber: 'ON-FIXTURE-4' });
    expect(manulife).toMatchObject({ enabled: true, providerNumber: 'ON-FIXTURE-5' });
    expect(greenShield?.enabled).toBe(false);

    await prisma.user.deleteMany({ where: { id: registerRes.body.user.id } });
    await prisma.practice.delete({ where: { id: practiceId } }).catch(() => undefined);
  });

  it('the group_admin owner invites a co-admin who joins the same organization on accept', async () => {
    const contactEmail = `co-admin-${suffix}@fixture.test`;

    const inviteRes = await request(app)
      .post('/api/auth/invite')
      .set('Cookie', ownerCookie)
      .send({ email: contactEmail, role: 'group_admin' });
    expect(inviteRes.status).toBe(200);
    expect(inviteRes.body.invited).toBe(true);

    const invite = await prisma.inviteToken.findFirstOrThrow({ where: { email: contactEmail } });
    expect(invite.role).toBe('group_admin');
    expect(invite.organizationId).toBe(organizationId);

    const acceptRes = await request(app).post('/api/auth/accept-invite').send({
      token: invite.token,
      displayName: 'Fixture Co-Admin',
      password: 'fixture-co-admin-pw',
    });
    expect(acceptRes.status).toBe(201);
    expect(acceptRes.body.role).toBe('group_admin');
    coAdminUserId = acceptRes.body.user.id;

    const membership = await prisma.organizationMember.findFirst({
      where: { organizationId, userId: coAdminUserId },
    });
    expect(membership).not.toBeNull();
    expect(membership?.role).toBe('org_admin');
  });

  it('a non-org practice_owner cannot invite a group_admin co-admin', async () => {
    const { practice, email, password } = await createPracticeWithOwnerForTests(prisma);
    outsidePracticeId = practice.id;

    const outsideLogin = await request(app).post('/api/auth/login').send({ email, password });
    expect(outsideLogin.status).toBe(200);
    const outsideCookie = extractCookie(outsideLogin);

    // A plain practice_owner (not an org_admin) must be rejected — canManageRole's
    // level check alone would have wrongly allowed this before the org-membership carve-out.
    const inviteRes = await request(app)
      .post('/api/auth/invite')
      .set('Cookie', outsideCookie)
      .send({ email: `stray-${suffix}@fixture.test`, role: 'group_admin' });
    expect(inviteRes.status).toBe(403);

    await cleanupPracticeWithUsers(prisma, practice.id);
    outsidePracticeId = undefined;
  });

  it('batch PMS import runs isolated per-practice imports for the caller\'s org, and rejects a practice outside it', async () => {
    const [practiceA, practiceB] = practiceIds;

    const importRes = await request(app)
      .post('/api/group/pms-import')
      .set('Cookie', ownerCookie)
      .send({
        imports: [
          { practiceId: practiceA, pmsVendor: 'other', records: csvRows('CLM-BATCH-A-1') },
          { practiceId: practiceB, pmsVendor: 'other', records: csvRows('CLM-BATCH-B-1') },
        ],
      });

    expect(importRes.status).toBe(200);
    const results = importRes.body.results as Array<{ practiceId: string; success: boolean; imported?: number }>;
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
    expect(results.every((r) => r.imported === 1)).toBe(true);

    const claimsA = await prisma.insuranceClaim.findMany({ where: { practiceId: practiceA } });
    const claimsB = await prisma.insuranceClaim.findMany({ where: { practiceId: practiceB } });
    expect(claimsA.map((c) => c.claimNumber)).toEqual(['CLM-BATCH-A-1']);
    expect(claimsB.map((c) => c.claimNumber)).toEqual(['CLM-BATCH-B-1']);

    const outsidePractice = await createPracticeForTests(prisma);
    outsidePracticeId = outsidePractice.id;

    const rejectedRes = await request(app)
      .post('/api/group/pms-import')
      .set('Cookie', ownerCookie)
      .send({
        imports: [
          { practiceId: outsidePractice.id, pmsVendor: 'other', records: csvRows('CLM-OUTSIDE-1') },
        ],
      });
    expect(rejectedRes.status).toBe(403);

    const outsideClaims = await prisma.insuranceClaim.findMany({ where: { practiceId: outsidePractice.id } });
    expect(outsideClaims).toHaveLength(0);
  });

  it('the org_admin owner adds a third location to the existing organization', async () => {
    const addRes = await request(app)
      .post('/api/group/practices')
      .set('Cookie', ownerCookie)
      .send({ practiceName: `Fixture Location C ${suffix}` });
    expect(addRes.status).toBe(201);
    practiceIds.push(addRes.body.practice.id);

    const me = await request(app).get('/api/auth/me').set('Cookie', ownerCookie);
    const mePracticeIds = (me.body.practices as Array<{ id: string }>).map((p) => p.id);
    expect(mePracticeIds).toEqual(expect.arrayContaining(practiceIds));
    expect(mePracticeIds.length).toBe(3);
  });

  it('the group_admin owner invites staff to a specific sibling practice, not their own', async () => {
    const [practiceA, practiceB] = practiceIds;
    const staffEmail = `sibling-staff-${suffix}@fixture.test`;

    const inviteRes = await request(app)
      .post('/api/auth/invite')
      .set('Cookie', ownerCookie)
      .send({ email: staffEmail, role: 'office_manager', practiceId: practiceB });
    expect(inviteRes.status).toBe(200);

    const invite = await prisma.inviteToken.findFirstOrThrow({ where: { email: staffEmail } });
    expect(invite.practiceId).toBe(practiceB);
    expect(invite.practiceId).not.toBe(practiceA);
    expect(invite.organizationId).toBeNull();

    const acceptRes = await request(app).post('/api/auth/accept-invite').send({
      token: invite.token,
      displayName: 'Sibling Staff',
      password: 'fixture-sibling-staff-pw',
    });
    expect(acceptRes.status).toBe(201);
    siblingInviteUserId = acceptRes.body.user.id;

    const user = await prisma.user.findUniqueOrThrow({ where: { id: siblingInviteUserId } });
    expect(user.practiceId).toBe(practiceB);
  });

  it('a group_admin cannot invite staff to a practice outside their organization', async () => {
    const outsidePractice = await createPracticeForTests(prisma);
    outsidePracticeId = outsidePractice.id;

    const inviteRes = await request(app)
      .post('/api/auth/invite')
      .set('Cookie', ownerCookie)
      .send({ email: `blocked-${suffix}@fixture.test`, role: 'office_manager', practiceId: outsidePractice.id });
    expect(inviteRes.status).toBe(403);

    await prisma.practice.delete({ where: { id: outsidePractice.id } }).catch(() => undefined);
    outsidePracticeId = undefined;
  });

  it('org membership management: list, demote, and block removing the last admin', async () => {
    const listRes = await request(app).get('/api/group/members').set('Cookie', ownerCookie);
    expect(listRes.status).toBe(200);
    const memberIds = (listRes.body.members as Array<{ userId: string }>).map((m) => m.userId);
    expect(memberIds).toEqual(expect.arrayContaining([ownerUserId, coAdminUserId]));

    // Demote the co-admin — org still has the owner as org_admin, so this is allowed.
    const demoteRes = await request(app)
      .patch(`/api/group/members/${coAdminUserId}`)
      .set('Cookie', ownerCookie)
      .send({ role: 'org_member' });
    expect(demoteRes.status).toBe(200);

    const membership = await prisma.organizationMember.findFirst({ where: { organizationId, userId: coAdminUserId } });
    expect(membership?.role).toBe('org_member');

    // The owner is now the sole org_admin — removing them must be blocked.
    const removeSelfRes = await request(app)
      .delete(`/api/group/members/${ownerUserId}`)
      .set('Cookie', ownerCookie);
    expect(removeSelfRes.status).toBe(400);

    // Removing the demoted co-admin (an org_member, not the last admin) is fine.
    const removeRes = await request(app)
      .delete(`/api/group/members/${coAdminUserId}`)
      .set('Cookie', ownerCookie);
    expect(removeRes.status).toBe(200);

    const removedMembership = await prisma.organizationMember.findFirst({ where: { organizationId, userId: coAdminUserId } });
    expect(removedMembership).toBeNull();

    // Removal downgrades the group_admin PracticeRole back to practice_owner.
    const removedUser = await prisma.user.findUniqueOrThrow({ where: { id: coAdminUserId } });
    expect(removedUser.role).toBe('practice_owner');
  });

  it('a standalone practice_owner self-converts into a new organization', async () => {
    const { practice, user, email, password } = await createPracticeWithOwnerForTests(prisma);
    convertedPracticeId = practice.id;
    convertedUserId = user.id;

    const login = await request(app).post('/api/auth/login').send({ email, password });
    expect(login.status).toBe(200);
    const cookie = extractCookie(login);

    const convertRes = await request(app)
      .post('/api/auth/convert-to-organization')
      .set('Cookie', cookie)
      .send({ organizationName: `Fixture Converted DSO ${suffix}` });
    expect(convertRes.status).toBe(201);
    expect(convertRes.body.role).toBe('group_admin');
    convertedOrganizationId = convertRes.body.organizationId;

    const membership = await prisma.organizationMember.findFirst({
      where: { organizationId: convertedOrganizationId, userId: convertedUserId },
    });
    expect(membership?.role).toBe('org_admin');

    const updatedUser = await prisma.user.findUniqueOrThrow({ where: { id: convertedUserId } });
    expect(updatedUser.role).toBe('group_admin');

    // Converting again must be rejected — already part of an organization.
    const secondConvertRes = await request(app)
      .post('/api/auth/convert-to-organization')
      .set('Cookie', extractCookie(convertRes))
      .send({ organizationName: 'Should Not Be Created' });
    expect(secondConvertRes.status).toBe(400);
  });
});
