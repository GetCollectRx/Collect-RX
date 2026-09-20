/**
 * Admin-assisted DSO/multi-location onboarding — POST /api/admin/organizations
 * followed by the primary contact accepting their group_admin invite.
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

describe.skipIf(!dbReady)('Admin org creation → group_admin onboarding', () => {
  let organizationId: string | undefined;
  let practiceIds: string[] = [];
  let contactUserId: string | undefined;

  afterAll(async () => {
    if (contactUserId) await prisma.user.deleteMany({ where: { id: contactUserId } });
    if (organizationId) {
      await prisma.organizationMember.deleteMany({ where: { organizationId } });
      await prisma.organizationPractice.deleteMany({ where: { organizationId } });
      await prisma.inviteToken.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
    }
    if (practiceIds.length) {
      await prisma.practice.deleteMany({ where: { id: { in: practiceIds } } });
    }
  });

  it('creates an org with N practices and lets the invited primary contact see all of them', async () => {
    const prev = process.env.PLATFORM_DEV_PASSWORD;
    process.env.PLATFORM_DEV_PASSWORD = DEV_PW;

    const login = await request(app).post('/api/auth/login/platform-dev').send({ password: DEV_PW });
    expect(login.status).toBe(200);
    const devCookie = extractCookie(login);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const contactEmail = `dso-owner-${suffix}@fixture.test`;

    const createRes = await request(app)
      .post('/api/admin/organizations')
      .set('Cookie', devCookie)
      .send({
        organizationName: `Fixture DSO ${suffix}`,
        practices: [{ practiceName: `Location A ${suffix}` }, { practiceName: `Location B ${suffix}` }],
        primaryContact: { email: contactEmail, displayName: 'Fixture Owner' },
      });

    expect(createRes.status).toBe(201);
    organizationId = createRes.body.organizationId;
    practiceIds = createRes.body.practices.map((p: { id: string }) => p.id);
    expect(practiceIds.length).toBe(2);

    const invite = await prisma.inviteToken.findFirstOrThrow({ where: { email: contactEmail } });
    expect(invite.role).toBe('group_admin');
    expect(invite.organizationId).toBe(organizationId);
    expect(invite.practiceId).toBe(practiceIds[0]);

    const acceptRes = await request(app).post('/api/auth/accept-invite').send({
      token: invite.token,
      displayName: 'Fixture Owner',
      password: 'fixture-dso-owner-pw',
    });
    expect(acceptRes.status).toBe(201);
    expect(acceptRes.body.role).toBe('group_admin');
    contactUserId = acceptRes.body.user.id;

    const membership = await prisma.organizationMember.findFirst({
      where: { organizationId, userId: contactUserId },
    });
    expect(membership).not.toBeNull();
    expect(membership?.role).toBe('org_admin');

    const contactCookie = extractCookie(acceptRes);
    const summary = await request(app).get('/api/group/practices-summary').set('Cookie', contactCookie);
    expect(summary.status).toBe(200);
    const summaryIds = (summary.body.practices as Array<{ id: string }>).map((p) => p.id).sort();
    expect(summaryIds).toEqual([...practiceIds].sort());

    // Practice switcher data: /api/auth/me must list every org practice, not
    // just the group_admin's own home practice (PracticeContext.tsx's switcher
    // renders off this array).
    const me = await request(app).get('/api/auth/me').set('Cookie', contactCookie);
    expect(me.status).toBe(200);
    const mePracticeIds = (me.body.practices as Array<{ id: string }>).map((p) => p.id).sort();
    expect(mePracticeIds).toEqual([...practiceIds].sort());

    if (prev === undefined) delete process.env.PLATFORM_DEV_PASSWORD;
    else process.env.PLATFORM_DEV_PASSWORD = prev;
  });
});
