/**
 * Fix 1/2 coverage: POST /api/eligibility/estimate persists an EligibilityEstimateLog row,
 * and GET /api/eligibility/status/:patientId/:carrier surfaces it back as `lastEstimate`.
 *
 * DB-dependent — skipped with a warning if DATABASE_URL is unreachable (same convention
 * as tests/workflowClaimLifecycle.test.ts and tests/app.integration.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
    '[eligibilityEstimatePersistence] DATABASE_URL unreachable — skipping:',
    (e as Error).message,
  );
}

function extractCookie(res: request.Response): string {
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie ?? '');
  return raw.match(/crx_access=[^;]+/)?.[0] ?? '';
}

describe.skipIf(!dbReady)('POST /api/eligibility/estimate persistence (P3-40)', () => {
  let practice: Awaited<ReturnType<typeof createPracticeWithOwnerForTests>>['practice'];
  let ownerCookie: string;

  const patientId = `patient-persist-${Date.now()}`;
  const carrier = 'sun_life';

  const estimateBody = {
    patientId,
    carrier,
    procedures: [
      { cdtCode: 'D1110', providerFee: 120, quantity: 1, dateOfService: '2026-05-01' },
    ],
    patient: {
      patientId,
      firstName: 'Jane',
      lastName: 'Doe',
      dateOfBirth: '1985-06-12',
      relationshipToSubscriber: 'self',
      primaryPlan: {
        planId: 'plan-persist-1',
        carrier,
        planName: 'Standard Group Plan',
        groupNumber: 'GRP-001',
        memberId: 'MBR-001',
        effectiveDate: '2024-01-01',
        terminationDate: null,
        planType: 'group',
      },
    },
  };

  beforeAll(async () => {
    const created = await createPracticeWithOwnerForTests(prisma);
    practice = created.practice;
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: created.email, password: created.password });
    expect(login.status).toBe(200);
    ownerCookie = extractCookie(login);
  }, 30_000);

  afterAll(async () => {
    await prisma.eligibilityEstimateLog.deleteMany({ where: { patientId } });
    await cleanupPracticeWithUsers(prisma, practice.id);
    await prisma.$disconnect().catch(() => undefined);
  });

  it('writes an EligibilityEstimateLog row on a successful estimate', async () => {
    const res = await request(app)
      .post('/api/eligibility/estimate')
      .set('Cookie', ownerCookie)
      .send(estimateBody);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.estimate?.patientId).toBe(patientId);

    const rows = await prisma.eligibilityEstimateLog.findMany({ where: { patientId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].carrier).toBe(carrier);
    expect(rows[0].practiceId).toBe(practice.id);
    const persistedResult = rows[0].resultJson as { estimate?: { estimateId?: string } };
    expect(persistedResult.estimate?.estimateId).toBe(res.body.estimate.estimateId);
  });

  it('GET /api/eligibility/status/:patientId/:carrier returns the persisted estimate as lastEstimate', async () => {
    const res = await request(app)
      .get(`/api/eligibility/status/${patientId}/${carrier}`)
      .set('Cookie', ownerCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.lastEstimate).toBeDefined();
    expect(res.body.lastEstimate.patientId).toBe(patientId);
    expect(res.body.lastEstimate.carrier).toBe(carrier);
  });
});
