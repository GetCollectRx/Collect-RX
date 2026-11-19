import { afterAll, describe, expect, it } from 'vitest';
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
    '[ontarioBillingRoutes] DATABASE_URL unreachable — DB-dependent tests will be skipped:',
    (e as Error).message,
  );
}

const createdPracticeIds: string[] = [];

afterAll(async () => {
  for (const id of createdPracticeIds) {
    await cleanupPracticeWithUsers(prisma, id);
  }
  await prisma.$disconnect().catch(() => undefined);
});

async function loginAgent() {
  const { practice, email } = await createPracticeWithOwnerForTests(prisma);
  createdPracticeIds.push(practice.id);
  const agent = request.agent(app);
  const loginRes = await agent.post('/api/auth/login').send({ email, password: FIXTURE_PRACTICE_PASSWORD });
  expect(loginRes.status).toBe(200);
  return agent;
}

describe.skipIf(!dbReady)('POST /api/ontario-billing/split', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app).post('/api/ontario-billing/split').send({
      odaFeeAmount: 200,
      cdcpFeeAmount: 150,
      coPayTier: 0,
      isProvincialSecondary: false,
    });
    expect(res.status).toBe(401);
  });

  it('returns the split-billing calculation for an authenticated practice session', async () => {
    const agent = await loginAgent();
    const res = await agent.post('/api/ontario-billing/split').send({
      odaFeeAmount: 200,
      cdcpFeeAmount: 150,
      coPayTier: 40,
      isProvincialSecondary: false,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.result.patientCoPayCents).toBe(6_000);
    expect(res.body.result.balanceBillingCents).toBe(5_000);
    expect(res.body.result.totalPatientResponsibilityCents).toBe(11_000);
  });

  it('zeroes patient responsibility and routes to secondary when isProvincialSecondary is true', async () => {
    const agent = await loginAgent();
    const res = await agent.post('/api/ontario-billing/split').send({
      odaFeeAmount: 200,
      cdcpFeeAmount: 150,
      coPayTier: 40,
      isProvincialSecondary: true,
    });

    expect(res.status).toBe(200);
    expect(res.body.result.totalPatientResponsibilityCents).toBe(0);
    // 6000 co-pay + 5000 ODA/CDCP gap — see the billingCalculator.test.ts
    // regression case for why the gap must be included, not just the co-pay.
    expect(res.body.result.secondaryRouteAmountCents).toBe(11_000);
  });

  it('rejects an invalid coPayTier', async () => {
    const agent = await loginAgent();
    const res = await agent.post('/api/ontario-billing/split').send({
      odaFeeAmount: 200,
      cdcpFeeAmount: 150,
      coPayTier: 25,
      isProvincialSecondary: false,
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
