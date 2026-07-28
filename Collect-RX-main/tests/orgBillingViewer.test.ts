/**
 * Phase 4 FR-7/8/9 (specs/phase-4-enterprise-it-compliance.md): the DSO
 * controller/CFO persona — an accountant-role User with org-level
 * org_billing_viewer access. Billing-only: can read/manage billing, but every
 * other /api/group/* route must explicitly reject them.
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../src/server/index.js';

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

const DEV_PW = process.env.PLATFORM_DEV_PASSWORD || 'collectrx-dev-platform-only';

describe.skipIf(!dbReady)('org_billing_viewer — billing-only DSO controller role', () => {
  let organizationId: string | undefined;
  let practiceIds: string[] = [];
  let orgAdminUserId: string | undefined;
  let viewerUserId: string | undefined;

  afterAll(async () => {
    if (viewerUserId) await prisma.user.deleteMany({ where: { id: viewerUserId } });
    if (orgAdminUserId) await prisma.user.deleteMany({ where: { id: orgAdminUserId } });
    if (organizationId) {
      await prisma.organizationMember.deleteMany({ where: { organizationId } });
      await prisma.organizationPractice.deleteMany({ where: { organizationId } });
      await prisma.inviteToken.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
    }
    if (practiceIds.length) await prisma.practice.deleteMany({ where: { id: { in: practiceIds } } });
  });

  it('org_admin can invite a billing viewer; the viewer gets billing access and is rejected everywhere else', async () => {
    const prev = process.env.PLATFORM_DEV_PASSWORD;
    process.env.PLATFORM_DEV_PASSWORD = DEV_PW;

    const login = await request(app).post('/api/auth/login/platform-dev').send({ password: DEV_PW });
    const devCookie = extractCookie(login);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const orgAdminEmail = `dso-admin-${suffix}@fixture.test`;
    const viewerEmail = `dso-controller-${suffix}@fixture.test`;

    const createRes = await request(app)
      .post('/api/admin/organizations')
      .set('Cookie', devCookie)
      .send({
        organizationName: `Fixture DSO Billing ${suffix}`,
        practices: [{ practiceName: `Billing Location ${suffix}` }],
        primaryContact: { email: orgAdminEmail, displayName: 'Fixture Admin' },
      });
    expect(createRes.status).toBe(201);
    organizationId = createRes.body.organizationId;
    practiceIds = createRes.body.practices.map((p: { id: string }) => p.id);

    const adminInvite = await prisma.inviteToken.findFirstOrThrow({ where: { email: orgAdminEmail } });
    const adminAccept = await request(app).post('/api/auth/accept-invite').send({
      token: adminInvite.token,
      displayName: 'Fixture Admin',
      password: 'fixture-dso-admin-pw',
    });
    expect(adminAccept.status).toBe(201);
    orgAdminUserId = adminAccept.body.user.id;
    const orgAdminCookie = extractCookie(adminAccept);

    // org_admin invites a billing viewer.
    const inviteRes = await request(app)
      .post('/api/auth/invite')
      .set('Cookie', orgAdminCookie)
      .send({ email: viewerEmail, role: 'accountant', orgRole: 'org_billing_viewer' });
    expect(inviteRes.status).toBe(200);

    const viewerInvite = await prisma.inviteToken.findFirstOrThrow({ where: { email: viewerEmail } });
    expect(viewerInvite.organizationId).toBe(organizationId);
    expect(viewerInvite.orgRole).toBe('org_billing_viewer');
    expect(viewerInvite.role).toBe('accountant');

    const viewerAccept = await request(app).post('/api/auth/accept-invite').send({
      token: viewerInvite.token,
      displayName: 'Fixture Controller',
      password: 'fixture-dso-controller-pw',
    });
    expect(viewerAccept.status).toBe(201);
    expect(viewerAccept.body.role).toBe('accountant');
    viewerUserId = viewerAccept.body.user.id;
    const viewerCookie = extractCookie(viewerAccept);

    const membership = await prisma.organizationMember.findFirst({ where: { organizationId, userId: viewerUserId } });
    expect(membership?.role).toBe('org_billing_viewer');

    // Allowed: billing read.
    const billing = await request(app).get('/api/group/billing').set('Cookie', viewerCookie);
    expect(billing.status).toBe(200);
    expect(billing.body.organization.id).toBe(organizationId);

    // Allowed (authorization-wise): billing portal — 400 "no billing account
    // yet" here proves they passed the org_billing_viewer gate and hit the
    // expected downstream business error, not a 403 authorization failure.
    const portal = await request(app).post('/api/group/billing/portal').set('Cookie', viewerCookie);
    expect(portal.status).toBe(400);

    // Blocked everywhere else — every route explicitly excludes org_billing_viewer (FR-8).
    const checkout = await request(app).post('/api/group/billing/checkout').set('Cookie', viewerCookie);
    expect(checkout.status).toBe(403);

    const cogsPooling = await request(app)
      .patch('/api/group/billing/cogs-pooling')
      .set('Cookie', viewerCookie)
      .send({ enabled: false });
    expect(cogsPooling.status).toBe(403);

    const summary = await request(app).get('/api/group/practices-summary').set('Cookie', viewerCookie);
    expect(summary.status).toBe(403);

    const complianceExport = await request(app).get('/api/group/compliance/export').set('Cookie', viewerCookie);
    expect(complianceExport.status).toBe(403);

    const pmsImport = await request(app)
      .post('/api/group/pms-import')
      .set('Cookie', viewerCookie)
      .send({ imports: [{ practiceId: practiceIds[0], pmsVendor: 'other', records: [{ a: 1 }] }] });
    expect(pmsImport.status).toBe(403);

    const addPractice = await request(app)
      .post('/api/group/practices')
      .set('Cookie', viewerCookie)
      .send({ practiceName: 'Should not be created' });
    expect(addPractice.status).toBe(403);

    const membersList = await request(app).get('/api/group/members').set('Cookie', viewerCookie);
    expect(membersList.status).toBe(403);

    const memberPatch = await request(app)
      .patch(`/api/group/members/${orgAdminUserId}`)
      .set('Cookie', viewerCookie)
      .send({ role: 'org_member' });
    expect(memberPatch.status).toBe(403);

    const memberDelete = await request(app).delete(`/api/group/members/${orgAdminUserId}`).set('Cookie', viewerCookie);
    expect(memberDelete.status).toBe(403);

    if (prev === undefined) delete process.env.PLATFORM_DEV_PASSWORD;
    else process.env.PLATFORM_DEV_PASSWORD = prev;
  });

  it('rejects orgRole "org_billing_viewer" paired with a role other than accountant', async () => {
    const prev = process.env.PLATFORM_DEV_PASSWORD;
    process.env.PLATFORM_DEV_PASSWORD = DEV_PW;
    const login = await request(app).post('/api/auth/login/platform-dev').send({ password: DEV_PW });
    const devCookie = extractCookie(login);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const orgAdminEmail = `dso-admin2-${suffix}@fixture.test`;
    const createRes = await request(app)
      .post('/api/admin/organizations')
      .set('Cookie', devCookie)
      .send({
        organizationName: `Fixture DSO Reject ${suffix}`,
        practices: [{ practiceName: `Reject Location ${suffix}` }],
        primaryContact: { email: orgAdminEmail, displayName: 'Fixture Admin 2' },
      });
    const orgId = createRes.body.organizationId;
    const practiceId = createRes.body.practices[0].id;
    const adminInvite = await prisma.inviteToken.findFirstOrThrow({ where: { email: orgAdminEmail } });
    const adminAccept = await request(app).post('/api/auth/accept-invite').send({
      token: adminInvite.token,
      displayName: 'Fixture Admin 2',
      password: 'fixture-dso-admin2-pw',
    });
    const orgAdminCookie = extractCookie(adminAccept);
    const adminUserId = adminAccept.body.user.id as string;

    const badInvite = await request(app)
      .post('/api/auth/invite')
      .set('Cookie', orgAdminCookie)
      .send({ email: `bad-${suffix}@fixture.test`, role: 'office_manager', orgRole: 'org_billing_viewer' });
    expect(badInvite.status).toBe(400);

    await prisma.user.deleteMany({ where: { id: adminUserId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationPractice.deleteMany({ where: { organizationId: orgId } });
    await prisma.inviteToken.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
    await prisma.practice.deleteMany({ where: { id: practiceId } });

    if (prev === undefined) delete process.env.PLATFORM_DEV_PASSWORD;
    else process.env.PLATFORM_DEV_PASSWORD = prev;
  });
});
