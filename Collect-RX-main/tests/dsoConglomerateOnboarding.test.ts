/**
 * Onboarding walk for a multi-location group at the scale we actually pitch
 * (7 locations), driven through the real HTTP API.
 *
 * The existing self-serve coverage exercises two locations and stops before
 * billing recovery. The confirm-overage route was missing entirely while its
 * service function and its button both existed, so this walks the whole path a
 * group takes — signup, cross-practice read, batch import, and resuming a
 * paused org — to catch wiring gaps that per-unit tests structurally cannot.
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
  return raw.match(/crx_access=[^;]+/)?.[0] ?? '';
}

const LOCATION_COUNT = 7;

function claimRow(claimNumber: string) {
  return {
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
  };
}

describe.skipIf(!dbReady)('7-location group onboarding', () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  let organizationId: string | undefined;
  let practiceIds: string[] = [];
  let ownerUserId: string | undefined;
  let ownerCookie = '';

  afterAll(async () => {
    for (const practiceId of practiceIds) {
      await prisma.pmsImportRun.deleteMany({ where: { practiceId } });
      await prisma.insuranceClaim.deleteMany({ where: { practiceId } });
    }
    if (ownerUserId) await prisma.user.deleteMany({ where: { id: ownerUserId } });
    if (organizationId) {
      await prisma.organizationMember.deleteMany({ where: { organizationId } });
      await prisma.organizationPractice.deleteMany({ where: { organizationId } });
      await prisma.inviteToken.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
    }
    if (practiceIds.length) {
      await prisma.inviteToken.deleteMany({ where: { practiceId: { in: practiceIds } } });
      await prisma.practice.deleteMany({ where: { id: { in: practiceIds } } });
    }
  });

  it('signs up all 7 locations under one organization in a single call', async () => {
    const additionalPractices = Array.from({ length: LOCATION_COUNT - 1 }, (_, i) => ({
      practiceName: `Fixture Group Location ${i + 2} ${suffix}`,
    }));

    const res = await request(app).post('/api/auth/register').send({
      practiceName: `Fixture Group Location 1 ${suffix}`,
      displayName: 'Group Owner',
      email: `group-owner-${suffix}@fixture.test`,
      password: 'fixture-group-owner-pw',
      organizationName: `Fixture Conglomerate ${suffix}`,
      additionalPractices,
    });

    expect(res.status).toBe(201);
    expect(res.body.role).toBe('group_admin');
    organizationId = res.body.organizationId;
    ownerUserId = res.body.user.id;
    ownerCookie = extractCookie(res);

    const me = await request(app).get('/api/auth/me').set('Cookie', ownerCookie);
    expect(me.status).toBe(200);
    practiceIds = (me.body.practices as Array<{ id: string }>).map((p) => p.id);
    expect(practiceIds).toHaveLength(LOCATION_COUNT);
  });

  it('returns every location on the group dashboard', async () => {
    const res = await request(app).get('/api/group/practices-summary').set('Cookie', ownerCookie);

    expect(res.status).toBe(200);
    const summaries = res.body.practices as Array<{ id: string; totalClaims: number }>;
    expect(summaries).toHaveLength(LOCATION_COUNT);
    // Each location is scoped through its own RLS context, so a missing scope
    // shows up as a practice silently reporting zero rather than an error.
    expect(new Set(summaries.map((s) => s.id))).toEqual(new Set(practiceIds));
  });

  it('batch imports claims into all 7 locations in one call', async () => {
    const imports = practiceIds.map((practiceId, i) => ({
      practiceId,
      pmsVendor: 'other',
      records: [claimRow(`GRP-${suffix}-${i}`)],
    }));

    const res = await request(app)
      .post('/api/group/pms-import')
      .set('Cookie', ownerCookie)
      .send({ imports });

    expect(res.status).toBe(200);
    const results = res.body.results as Array<{ practiceId: string; success: boolean; imported?: number }>;
    expect(results).toHaveLength(LOCATION_COUNT);
    expect(results.every((r) => r.success)).toBe(true);
    expect(results.reduce((sum, r) => sum + (r.imported ?? 0), 0)).toBe(LOCATION_COUNT);
  });

  it('reflects the imported claims back on the group dashboard', async () => {
    const res = await request(app).get('/api/group/practices-summary').set('Cookie', ownerCookie);

    expect(res.status).toBe(200);
    const summaries = res.body.practices as Array<{ totalClaims: number }>;
    expect(summaries.reduce((sum, s) => sum + s.totalClaims, 0)).toBe(LOCATION_COUNT);
  });

  it('resumes the whole group after the org_admin confirms a pooled overage', async () => {
    await prisma.organization.update({
      where: { id: organizationId },
      data: { callsPaused: true, callsPausedReason: 'overage_pending', callsPausedAt: new Date() },
    });

    const res = await request(app).post('/api/group/billing/confirm-overage').set('Cookie', ownerCookie);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('resumed');

    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    expect(org?.callsPaused).toBe(false);
    expect(org?.callsPausedReason).toBeNull();
    expect(org?.overageConfirmed).toBe(true);
  });

  it('reports not_paused when the group is not actually paused for overage', async () => {
    const res = await request(app).post('/api/group/billing/confirm-overage').set('Cookie', ownerCookie);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('not_paused');
  });

  it('rejects a confirm-overage attempt from outside the organization', async () => {
    const outsider = await request(app).post('/api/auth/register').send({
      practiceName: `Fixture Outsider Practice ${suffix}`,
      displayName: 'Outsider Owner',
      email: `outsider-${suffix}@fixture.test`,
      password: 'fixture-outsider-pw',
    });
    expect(outsider.status).toBe(201);
    const outsiderCookie = extractCookie(outsider);

    const res = await request(app).post('/api/group/billing/confirm-overage').set('Cookie', outsiderCookie);
    expect(res.status).toBe(403);

    await prisma.user.deleteMany({ where: { id: outsider.body.user.id } });
    await prisma.practice.deleteMany({ where: { id: outsider.body.practice?.id ?? '' } });
  });
});
