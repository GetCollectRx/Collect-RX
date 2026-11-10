/**
 * End-to-end check of the non-dental AR view: synthetic exports go in through
 * the real POST /api/insurance/claims/upload route (real importer, real vault,
 * real Postgres) and come back out through the summary and worklist routes.
 *
 * All data is synthetic. Payer names are deliberately fake ("Synthetic Mutual",
 * "Placeholder General"); people, VINs and policy numbers are invented.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../src/server/index.js';
import { COOKIE_NAME, signUserToken } from '../src/server/authToken.js';
import { runWithRlsBypass } from '../src/server/db/rlsContext.js';
import { cleanupPracticeWithUsers, createPracticeWithOwnerForTests } from './factories/practice.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn('[industryArRoutes.integration] DATABASE_URL unreachable, tests skipped:', (e as Error).message);
}

const DAY_MS = 86_400_000;
const isoDaysAgo = (n: number): string => new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);

const SECRET_VALUES = ['Alexis Synthetic', 'Morgan Placeholder', 'Riley Fixture', 'SYNTHVIN0000000001', 'SYNTHVIN0000000002', 'POL-SYN-7781'];

const AUTO_CSV = [
  'RO #,VIN,Insurance Company,Claim #,Customer Name,Date of Loss,Total Gross Estimate,Insurance Balance',
  `RO-A1,SYNTHVIN0000000001,Synthetic Mutual Insurance Inc.,AC-100,Alexis Synthetic,${isoDaysAgo(150)},9500.00,9000.00`,
  `RO-A2,SYNTHVIN0000000002,SYNTHETIC MUTUAL INS.,AC-101,Morgan Placeholder,${isoDaysAgo(12)},400.00,250.00`,
  `RO-A3,SYNTHVIN0000000003,Placeholder General Insurance,AC-102,Riley Fixture,${isoDaysAgo(40)},800.00,0.00`,
].join('\n');

const RESTORATION_CSV = [
  'Job #,Policy #,Insurance Carrier,Claim #,Customer Name,Date of Loss,Estimate Total,Outstanding Balance',
  `JOB-R1,POL-SYN-7781,synthetic mutual,PR-200,Riley Fixture,${isoDaysAgo(95)},12000.00,5000.00`,
].join('\n');

const OTHER_PRACTICE_CSV = [
  'RO #,VIN,Insurance Company,Claim #,Customer Name,Date of Loss,Total Gross Estimate,Insurance Balance',
  `RO-Z1,SYNTHVIN0000000099,Synthetic Mutual Insurance Inc.,ZZ-900,Other Practice Person,${isoDaysAgo(300)},99999.00,77777.00`,
].join('\n');

function cookieFor(practiceId: string, userId: string): string {
  return `${COOKIE_NAME}=${signUserToken({ userId, practiceId, role: 'practice_owner' })}`;
}

async function upload(cookie: string, industryType: string, csv: string): Promise<request.Response> {
  return request(app)
    .post('/api/insurance/claims/upload')
    .set('Cookie', cookie)
    .field('industryType', industryType)
    .field('dateFormat', 'YMD')
    .attach('file', Buffer.from(csv, 'utf8'), { filename: 'export.csv', contentType: 'text/csv' });
}

interface PayerRow { payerKey: string; payerName: string; claims: number; balanceCents: number; industries: string[]; oldestAgeDays: number }
interface WorklistRow { claimId: string; claimNumber: string; payerKey: string; ageDays: number; agingBucket: string; balanceCents: number; dialable: boolean }

describe.skipIf(!dbReady)('Non-dental AR summary and worklist (integration)', () => {
  let practiceA = '';
  let practiceB = '';
  let cookieA = '';
  let cookieB = '';

  beforeAll(async () => {
    const a = await createPracticeWithOwnerForTests(prisma);
    const b = await createPracticeWithOwnerForTests(prisma);
    practiceA = a.practice.id;
    practiceB = b.practice.id;
    cookieA = cookieFor(practiceA, a.user.id);
    cookieB = cookieFor(practiceB, b.user.id);

    for (const [cookie, industry, csv] of [
      [cookieA, 'AUTO_COLLISION', AUTO_CSV],
      [cookieA, 'PROPERTY_RESTORATION', RESTORATION_CSV],
      [cookieB, 'AUTO_COLLISION', OTHER_PRACTICE_CSV],
    ] as const) {
      const res = await upload(cookie, industry, csv);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
  });

  afterAll(async () => {
    await runWithRlsBypass(async () => {
      await prisma.auditLog.deleteMany({ where: { practiceId: { in: [practiceA, practiceB] } } }).catch(() => undefined);
      await prisma.insuranceClaim.deleteMany({ where: { practiceId: { in: [practiceA, practiceB] } } });
    });
    await cleanupPracticeWithUsers(prisma, practiceA);
    await cleanupPracticeWithUsers(prisma, practiceB);
    await prisma.$disconnect().catch(() => undefined);
  });

  it('requires a session', async () => {
    const res = await request(app).get('/api/insurance/claims/industry/summary');
    expect(res.status).toBe(401);
  });

  it('summarises only the session practice, with spelling variants merged into one payer', async () => {
    const res = await request(app).get('/api/insurance/claims/industry/summary').set('Cookie', cookieA);
    expect(res.status).toBe(200);
    const data = res.body.data as {
      totals: { claims: number; balanceCents: number };
      byPayer: PayerRow[];
      byIndustry: { industryType: string; claims: number }[];
      buckets: Record<string, { claims: number }>;
      dialable: boolean;
      notDialableReason: string;
    };
    expect(data.totals).toEqual({ claims: 3, balanceCents: 900000 + 25000 + 500000 });
    expect(data.byPayer).toHaveLength(1);
    expect(data.byPayer[0]).toMatchObject({
      payerKey: 'synthetic mutual',
      claims: 3,
      balanceCents: 1425000,
      industries: ['AUTO_COLLISION', 'PROPERTY_RESTORATION'],
    });
    expect(data.byPayer[0]?.oldestAgeDays).toBeGreaterThanOrEqual(149);
    expect(data.buckets['120+']?.claims).toBe(1);
    expect(data.buckets['90-119']?.claims).toBe(1);
    expect(data.buckets['0-29']?.claims).toBe(1);
    expect(data.dialable).toBe(false);
    expect(data.notDialableReason).toBe('NO_VERIFIED_PAYER_LINE');
    expect(JSON.stringify(res.body)).not.toContain('ZZ-900');
  });

  it('keeps the other practice isolated in both directions', async () => {
    const res = await request(app).get('/api/insurance/claims/industry/worklist').set('Cookie', cookieB);
    expect(res.status).toBe(200);
    const items = res.body.data.items as WorklistRow[];
    expect(items.map((i) => i.claimNumber)).toEqual(['ZZ-900']);

    const forged = await request(app)
      .get('/api/insurance/claims/industry/summary')
      .query({ practiceId: practiceB })
      .set('Cookie', cookieA);
    expect(forged.status).toBe(403);
  });

  it('lists the worklist oldest and largest first, ages live, and marks nothing dialable', async () => {
    const res = await request(app).get('/api/insurance/claims/industry/worklist').set('Cookie', cookieA);
    expect(res.status).toBe(200);
    const items = res.body.data.items as WorklistRow[];
    expect(items.map((i) => i.claimNumber)).toEqual(['AC-100', 'PR-200', 'AC-101']);
    expect(items[0]).toMatchObject({ agingBucket: '120+', balanceCents: 900000, payerKey: 'synthetic mutual' });
    expect(items[0]?.ageDays).toBeGreaterThanOrEqual(149);
    expect(items.every((i) => i.dialable === false)).toBe(true);
  });

  it('filters by industry and payer, and validates its query', async () => {
    const byIndustry = await request(app)
      .get('/api/insurance/claims/industry/worklist')
      .query({ industryType: 'PROPERTY_RESTORATION' })
      .set('Cookie', cookieA);
    expect((byIndustry.body.data.items as WorklistRow[]).map((i) => i.claimNumber)).toEqual(['PR-200']);

    const byPayer = await request(app)
      .get('/api/insurance/claims/industry/worklist')
      .query({ payerKey: 'synthetic mutual', limit: '2' })
      .set('Cookie', cookieA);
    expect((byPayer.body.data.items as WorklistRow[]).map((i) => i.claimNumber)).toEqual(['AC-100', 'PR-200']);

    const dental = await request(app)
      .get('/api/insurance/claims/industry/worklist')
      .query({ industryType: 'DENTAL' })
      .set('Cookie', cookieA);
    expect(dental.status).toBe(400);

    const longPayer = await request(app)
      .get('/api/insurance/claims/industry/worklist')
      .query({ payerKey: 'x'.repeat(201) })
      .set('Cookie', cookieA);
    expect(longPayer.status).toBe(400);
  });

  it('never returns PHI or vault tokens', async () => {
    const stored = await runWithRlsBypass(() =>
      prisma.insuranceClaim.findMany({
        where: { practiceId: practiceA },
        select: { patientToken: true, secondaryReferenceId: true },
      }),
    );
    const tokens = stored.flatMap((c) => [c.patientToken, c.secondaryReferenceId]).filter((t): t is string => Boolean(t));
    expect(tokens.length).toBeGreaterThan(0);

    for (const path of ['/api/insurance/claims/industry/summary', '/api/insurance/claims/industry/worklist']) {
      const body = JSON.stringify((await request(app).get(path).set('Cookie', cookieA)).body);
      for (const value of [...SECRET_VALUES, ...tokens]) expect(body).not.toContain(value);
      expect(body).not.toContain('RO-A1');
      expect(body).not.toContain('JOB-R1');
    }
  });

  // Runs last: it changes practice A's data.
  it('drops a claim from the open view when a later export shows it paid', async () => {
    const paid = [
      'RO #,VIN,Insurance Company,Claim #,Customer Name,Date of Loss,Total Gross Estimate,Insurance Balance',
      `RO-A1,SYNTHVIN0000000001,Synthetic Mutual Insurance Inc.,AC-100,Alexis Synthetic,${isoDaysAgo(150)},9500.00,0.00`,
    ].join('\n');
    const res = await upload(cookieA, 'AUTO_COLLISION', paid);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ zeroedExisting: 1, skippedZeroBalance: 0, imported: 0, updated: 0 });

    const worklist = await request(app).get('/api/insurance/claims/industry/worklist').set('Cookie', cookieA);
    expect((worklist.body.data.items as WorklistRow[]).map((i) => i.claimNumber)).toEqual(['PR-200', 'AC-101']);
    const summary = await request(app).get('/api/insurance/claims/industry/summary').set('Cookie', cookieA);
    expect(summary.body.data.totals).toEqual({ claims: 2, balanceCents: 525000 });
  });
});
