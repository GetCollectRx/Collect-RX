/**
 * Phase 4 FR-10-13 (specs/phase-4-enterprise-it-compliance.md): the
 * auditor-facing GET /api/group/compliance/export/v2 bundle — org_admin
 * only, produces a real zip, and records a chain-of-custody row.
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

describe.skipIf(!dbReady)('GET /api/group/compliance/export/v2', () => {
  let organizationId: string | undefined;
  let practiceIds: string[] = [];
  let orgAdminUserId: string | undefined;

  afterAll(async () => {
    if (organizationId) await prisma.orgComplianceExport.deleteMany({ where: { organizationId } });
    if (orgAdminUserId) await prisma.user.deleteMany({ where: { id: orgAdminUserId } });
    if (organizationId) {
      await prisma.organizationMember.deleteMany({ where: { organizationId } });
      await prisma.organizationPractice.deleteMany({ where: { organizationId } });
      await prisma.inviteToken.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
    }
    if (practiceIds.length) {
      await prisma.auditLog.deleteMany({ where: { practiceId: { in: practiceIds } } });
      await prisma.practice.deleteMany({ where: { id: { in: practiceIds } } });
    }
  });

  it('produces a real zip, records chain-of-custody, and rejects a non-admin org member', async () => {
    const prev = process.env.PLATFORM_DEV_PASSWORD;
    process.env.PLATFORM_DEV_PASSWORD = DEV_PW;

    const login = await request(app).post('/api/auth/login/platform-dev').send({ password: DEV_PW });
    const devCookie = extractCookie(login);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const orgAdminEmail = `dso-audit-admin-${suffix}@fixture.test`;

    const createRes = await request(app)
      .post('/api/admin/organizations')
      .set('Cookie', devCookie)
      .send({
        organizationName: `Fixture DSO Audit ${suffix}`,
        practices: [{ practiceName: `Audit Location ${suffix}` }],
        primaryContact: { email: orgAdminEmail, displayName: 'Fixture Audit Admin' },
      });
    organizationId = createRes.body.organizationId;
    practiceIds = createRes.body.practices.map((p: { id: string }) => p.id);

    const adminInvite = await prisma.inviteToken.findFirstOrThrow({ where: { email: orgAdminEmail } });
    const adminAccept = await request(app).post('/api/auth/accept-invite').send({
      token: adminInvite.token,
      displayName: 'Fixture Audit Admin',
      password: 'fixture-dso-audit-admin-pw',
    });
    orgAdminUserId = adminAccept.body.user.id;
    const orgAdminCookie = extractCookie(adminAccept);

    // Seed one AuditLog row inside the export window so the bundle isn't trivially empty.
    await prisma.auditLog.create({
      data: {
        practiceId: practiceIds[0],
        userId: orgAdminUserId,
        action: 'test.compliance_export_fixture',
      },
    });

    const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const missingParams = await request(app).get('/api/group/compliance/export/v2').set('Cookie', orgAdminCookie);
    expect(missingParams.status).toBe(400);

    const exportRes = await request(app)
      .get(`/api/group/compliance/export/v2?from=${from}&to=${to}`)
      .set('Cookie', orgAdminCookie)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(exportRes.status).toBe(200);
    expect(exportRes.headers['content-type']).toBe('application/zip');
    const checksumHeader = exportRes.headers['x-collectrx-export-checksum'];
    expect(checksumHeader).toBeTruthy();

    const body = exportRes.body as Buffer;
    expect(body.length).toBeGreaterThan(0);
    // ZIP local-file-header magic bytes — proves this is a real zip, not an
    // empty or malformed stream.
    expect(body.subarray(0, 4).toString('hex')).toBe('504b0304');

    const record = await prisma.orgComplianceExport.findFirst({ where: { organizationId } });
    expect(record).not.toBeNull();
    expect(record?.checksum).toBe(checksumHeader);
    expect(record?.exportedBy).toBe(orgAdminUserId);

    // A plain org_member (not org_admin) must be rejected — v2 is org_admin-only.
    await prisma.organizationMember.updateMany({
      where: { organizationId, userId: orgAdminUserId },
      data: { role: 'org_member' },
    });
    const rejected = await request(app)
      .get(`/api/group/compliance/export/v2?from=${from}&to=${to}`)
      .set('Cookie', orgAdminCookie);
    expect(rejected.status).toBe(403);

    if (prev === undefined) delete process.env.PLATFORM_DEV_PASSWORD;
    else process.env.PLATFORM_DEV_PASSWORD = prev;
  });
});
