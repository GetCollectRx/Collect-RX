/**
 * Phase 4 FR-1-6 (specs/phase-4-enterprise-it-compliance.md): SAML SSO front
 * door. Covers config management, SP-initiated redirect, metadata, the
 * domain-based password-login gate, rejection of an invalid/unsigned
 * assertion, AND acceptance of a genuinely signed one (tests/helpers/mockSamlIdp.ts
 * — a throwaway self-signed cert signs a real assertion via xml-crypto, the
 * same library node-saml uses internally, so this exercises real crypto
 * verification rather than a mocked SAML client).
 */
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../src/server/index.js';
import { createPracticeWithOwnerForTests, cleanupPracticeWithUsers } from './factories/practice.js';
import { serverBaseUrl } from '../src/server/sso/organizationSsoService.js';
import { generateSelfSignedIdpCert, buildSignedSamlResponse } from './helpers/mockSamlIdp.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch {
  /* skip */
}

// saveOrganizationSsoConfig encrypts the IdP connection at rest (phiAtRest) —
// needs a real key present, same per-file scoping convention as phiAtRest.test.ts.
const prevPhiKey = process.env.PHI_ENCRYPTION_KEY;
beforeEach(() => {
  process.env.PHI_ENCRYPTION_KEY = randomBytes(32).toString('hex');
});
afterEach(() => {
  if (prevPhiKey === undefined) delete process.env.PHI_ENCRYPTION_KEY;
  else process.env.PHI_ENCRYPTION_KEY = prevPhiKey;
});

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
const FAKE_IDP_CERT =
  '-----BEGIN CERTIFICATE-----\nMIIBmzCCAQQCCQDvZ8g6/2ZzZTANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDDAlm\naXh0dXJlLWlkcDAeFw0yNjAxMDEwMDAwMDBaFw0zNjAxMDEwMDAwMDBaMBQxEjAQ\nBgNVBAMMCWZpeHR1cmUtaWQwXDANBgkqhkiG9w0BAQEFAANLADBIAkEAsomefixt\nurecertificatedataforfixtureidpxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxwIDAQABMA0GCSqGSIb3DQEBCwUAA0EA\nfixturefixturefixturefixturefixturefixturefixturefixturefixture\nfixturefixturefixturefixture==\n-----END CERTIFICATE-----';

describe.skipIf(!dbReady)('Organization SSO (SAML)', () => {
  let organizationId: string | undefined;
  let practiceIds: string[] = [];
  let orgAdminUserId: string | undefined;

  afterAll(async () => {
    if (organizationId) await prisma.organizationSsoConfig.deleteMany({ where: { organizationId } });
    if (orgAdminUserId) await prisma.user.deleteMany({ where: { id: orgAdminUserId } });
    if (organizationId) {
      await prisma.organizationMember.deleteMany({ where: { organizationId } });
      await prisma.organizationPractice.deleteMany({ where: { organizationId } });
      await prisma.inviteToken.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
    }
    if (practiceIds.length) await prisma.practice.deleteMany({ where: { id: { in: practiceIds } } });
  });

  it('platform_dev configures SSO; org_admin can then read status and toggle enforcement; a non-admin is rejected', async () => {
    const prev = process.env.PLATFORM_DEV_PASSWORD;
    process.env.PLATFORM_DEV_PASSWORD = DEV_PW;
    const login = await request(app).post('/api/auth/login/platform-dev').send({ password: DEV_PW });
    const devCookie = extractCookie(login);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const orgAdminEmail = `sso-admin-${suffix}@fixture-dso.test`;

    const createRes = await request(app)
      .post('/api/admin/organizations')
      .set('Cookie', devCookie)
      .send({
        organizationName: `Fixture SSO DSO ${suffix}`,
        practices: [{ practiceName: `SSO Location ${suffix}` }],
        primaryContact: { email: orgAdminEmail, displayName: 'Fixture SSO Admin' },
      });
    organizationId = createRes.body.organizationId;
    practiceIds = createRes.body.practices.map((p: { id: string }) => p.id);

    const adminInvite = await prisma.inviteToken.findFirstOrThrow({ where: { email: orgAdminEmail } });
    const adminAccept = await request(app).post('/api/auth/accept-invite').send({
      token: adminInvite.token,
      displayName: 'Fixture SSO Admin',
      password: 'fixture-sso-admin-pw',
    });
    orgAdminUserId = adminAccept.body.user.id;
    const orgAdminCookie = extractCookie(adminAccept);

    const orgSlug = `fixture-dso-${suffix.slice(0, 12)}`;

    // Only platform_dev can configure the connection.
    const nonAdminAttempt = await request(app)
      .post(`/api/admin/organizations/${organizationId}/sso-config`)
      .set('Cookie', orgAdminCookie)
      .send({
        orgSlug,
        entryPoint: 'https://idp.fixture-dso.test/sso',
        idpCert: FAKE_IDP_CERT,
        enforcedDomains: ['fixture-dso.test'],
      });
    expect(nonAdminAttempt.status).toBe(403);

    const configRes = await request(app)
      .post(`/api/admin/organizations/${organizationId}/sso-config`)
      .set('Cookie', devCookie)
      .send({
        orgSlug,
        entryPoint: 'https://idp.fixture-dso.test/sso',
        idpCert: FAKE_IDP_CERT,
        enforcedDomains: ['fixture-dso.test'],
      });
    expect(configRes.status).toBe(201);
    expect(configRes.body.orgSlug).toBe(orgSlug);

    const statusRes = await request(app)
      .get(`/api/admin/organizations/${organizationId}/sso-config`)
      .set('Cookie', devCookie);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.configured).toBe(true);
    expect(statusRes.body.ssoEnforced).toBe(false);
    expect(statusRes.body).not.toHaveProperty('idpCert');
    expect(statusRes.body).not.toHaveProperty('entryPoint');

    // Metadata is public once configured.
    const metadataRes = await request(app).get(`/api/auth/sso/${orgSlug}/metadata`);
    expect(metadataRes.status).toBe(200);
    expect(metadataRes.headers['content-type']).toContain('xml');
    expect(metadataRes.text).toContain('EntityDescriptor');

    // SP-initiated login redirects to the configured IdP entryPoint.
    const loginInit = await request(app).post(`/api/auth/sso/${orgSlug}/login`).send({});
    expect(loginInit.status).toBe(302);
    expect(loginInit.headers.location).toContain('idp.fixture-dso.test');

    // org_admin (not a random org_member) can flip enforcement.
    const enforceOn = await request(app)
      .patch('/api/group/sso/enforce')
      .set('Cookie', orgAdminCookie)
      .send({ enabled: true });
    expect(enforceOn.status).toBe(200);
    expect(enforceOn.body.ssoEnforced).toBe(true);

    // Password login is now blocked for this org's domain.
    const blockedLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: orgAdminEmail, password: 'fixture-sso-admin-pw' });
    expect(blockedLogin.status).toBe(403);
    expect(blockedLogin.body.ssoLoginUrl).toBe(`/api/auth/sso/${orgSlug}/login`);

    // A user on an unrelated domain is unaffected.
    const outsideEmail = `unrelated-${suffix}@not-the-sso-domain.test`;
    const outsidePractice = await createPracticeWithOwnerForTests(prisma);
    await prisma.user.update({ where: { id: outsidePractice.user.id }, data: { email: outsideEmail } });
    const unaffectedLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: outsideEmail, password: outsidePractice.password });
    expect(unaffectedLogin.status).toBe(200);
    await cleanupPracticeWithUsers(prisma, outsidePractice.practice.id);

    // An unsigned/malformed assertion at the ACS endpoint must never authenticate anyone.
    const forgedAcs = await request(app)
      .post(`/api/auth/sso/${orgSlug}/acs`)
      .type('form')
      .send({ SAMLResponse: Buffer.from('<not a valid saml response/>').toString('base64') });
    expect([302, 500]).toContain(forgedAcs.status);
    expect(extractCookie(forgedAcs)).toBe('');

    // The failure is recorded even though AuditLog can't hold it (no matched user → no practiceId).
    const failureEvent = await prisma.orgSsoEvent.findFirst({
      where: { organizationId, eventType: 'login_failed' },
      orderBy: { createdAt: 'desc' },
    });
    expect(failureEvent).not.toBeNull();

    // Break-glass: platform_dev force-disables enforcement with a mandatory reason.
    const badReason = await request(app)
      .post(`/api/admin/organizations/${organizationId}/sso/break-glass`)
      .set('Cookie', devCookie)
      .send({ reason: 'short' });
    expect(badReason.status).toBe(400);

    const breakGlass = await request(app)
      .post(`/api/admin/organizations/${organizationId}/sso/break-glass`)
      .set('Cookie', devCookie)
      .send({ reason: "IdP outage at fixture-dso.test — org_admin locked out, disabling enforcement." });
    expect(breakGlass.status).toBe(200);
    expect(breakGlass.body.ssoEnforced).toBe(false);

    const statusAfterBreakGlass = await request(app)
      .get(`/api/admin/organizations/${organizationId}/sso-config`)
      .set('Cookie', devCookie);
    expect(statusAfterBreakGlass.body.ssoEnforced).toBe(false);

    const breakGlassEvent = await prisma.orgSsoEvent.findFirst({
      where: { organizationId, eventType: 'break_glass_disabled' },
    });
    expect(breakGlassEvent).not.toBeNull();
    expect(breakGlassEvent?.detail).toContain('IdP outage');

    // Password login works again immediately — no separate re-enable step needed.
    const restoredLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: orgAdminEmail, password: 'fixture-sso-admin-pw' });
    expect(restoredLogin.status).toBe(200);

    if (prev === undefined) delete process.env.PLATFORM_DEV_PASSWORD;
    else process.env.PLATFORM_DEV_PASSWORD = prev;
  });

  it('metadata and login return 404 for an unconfigured org slug', async () => {
    const metadataRes = await request(app).get('/api/auth/sso/not-a-real-org-slug/metadata');
    expect(metadataRes.status).toBe(404);
    const loginRes = await request(app).post('/api/auth/sso/not-a-real-org-slug/login').send({});
    expect(loginRes.status).toBe(404);
  });

  describe('ACS acceptance path — a genuinely signed assertion', () => {
    let acceptOrgId: string | undefined;
    let acceptPracticeIds: string[] = [];

    afterAll(async () => {
      if (acceptOrgId) await prisma.organizationSsoConfig.deleteMany({ where: { organizationId: acceptOrgId } });
      if (acceptOrgId) {
        await prisma.organizationMember.deleteMany({ where: { organizationId: acceptOrgId } });
        await prisma.organizationPractice.deleteMany({ where: { organizationId: acceptOrgId } });
        await prisma.inviteToken.deleteMany({ where: { organizationId: acceptOrgId } });
      }
      if (acceptPracticeIds.length) {
        await prisma.user.deleteMany({ where: { practiceId: { in: acceptPracticeIds } } });
        await prisma.practice.deleteMany({ where: { id: { in: acceptPracticeIds } } });
      }
      if (acceptOrgId) await prisma.organization.delete({ where: { id: acceptOrgId } }).catch(() => undefined);
    });

    it('a real signed assertion authenticates the matched user and sets a session cookie', async () => {
      const prev = process.env.PLATFORM_DEV_PASSWORD;
      process.env.PLATFORM_DEV_PASSWORD = DEV_PW;
      const login = await request(app).post('/api/auth/login/platform-dev').send({ password: DEV_PW });
      const devCookie = extractCookie(login);

      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const orgAdminEmail = `sso-accept-admin-${suffix}@fixture-accept.test`;

      const createRes = await request(app)
        .post('/api/admin/organizations')
        .set('Cookie', devCookie)
        .send({
          organizationName: `Fixture SSO Accept ${suffix}`,
          practices: [{ practiceName: `Accept Location ${suffix}` }],
          primaryContact: { email: orgAdminEmail, displayName: 'Fixture Accept Admin' },
        });
      acceptOrgId = createRes.body.organizationId;
      acceptPracticeIds = createRes.body.practices.map((p: { id: string }) => p.id);

      const adminInvite = await prisma.inviteToken.findFirstOrThrow({ where: { email: orgAdminEmail } });
      const adminAccept = await request(app).post('/api/auth/accept-invite').send({
        token: adminInvite.token,
        displayName: 'Fixture Accept Admin',
        password: 'fixture-sso-accept-admin-pw',
      });
      const orgAdminUserId = adminAccept.body.user.id as string;

      const orgSlug = `fixture-accept-${suffix.slice(0, 10)}`;
      const { privateKeyPem, certPem } = generateSelfSignedIdpCert();

      const configRes = await request(app)
        .post(`/api/admin/organizations/${acceptOrgId}/sso-config`)
        .set('Cookie', devCookie)
        .send({
          orgSlug,
          entryPoint: 'https://idp.fixture-accept.test/sso',
          idpCert: certPem,
          enforcedDomains: [],
        });
      expect(configRes.status).toBe(201);

      const spIssuer = `${serverBaseUrl()}/api/auth/sso/${orgSlug}/metadata`;
      const acsUrl = `${serverBaseUrl()}/api/auth/sso/${orgSlug}/acs`;
      const samlResponse = buildSignedSamlResponse({
        privateKeyPem,
        issuer: 'https://idp.fixture-accept.test/entity',
        audience: spIssuer,
        destination: acsUrl,
        nameId: orgAdminEmail,
      });

      const acsRes = await request(app)
        .post(`/api/auth/sso/${orgSlug}/acs`)
        .type('form')
        .send({ SAMLResponse: samlResponse });

      expect(acsRes.status).toBe(302);
      const ssoCookie = extractCookie(acsRes);
      expect(ssoCookie).toMatch(/crx_access=/);

      const me = await request(app).get('/api/auth/me').set('Cookie', ssoCookie);
      expect(me.status).toBe(200);
      expect(me.body.user.id).toBe(orgAdminUserId);
      expect(me.body.user.email).toBe(orgAdminEmail);

      const successLog = await prisma.auditLog.findFirst({
        where: { userId: orgAdminUserId, action: 'auth.sso.login' },
      });
      expect(successLog).not.toBeNull();

      if (prev === undefined) delete process.env.PLATFORM_DEV_PASSWORD;
      else process.env.PLATFORM_DEV_PASSWORD = prev;
    });
  });
});
