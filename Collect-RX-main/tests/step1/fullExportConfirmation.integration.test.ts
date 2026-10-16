/**
 * DEC-14 slice 1: a full export tells staff how many open claims it would stop
 * calling before it does, and applies only the count they confirmed. Real
 * Postgres and the real routes. Skipped with a log line when DATABASE_URL is
 * unreachable, like the other DB-backed suites.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../../src/server/index.js';
import { createPracticeWithOwnerForTests, cleanupPracticeWithUsers } from '../factories/practice.js';
import { COOKIE_NAME, signUserToken } from '../../src/server/authToken.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn('[fullExportConfirmation] DATABASE_URL unreachable, skipping:', (e as Error).message);
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

const HEADER =
  'claim_number,patient_first_name,patient_last_name,carrier_name,procedure_code,amount_billed,amount_outstanding,days_outstanding,patient_dob,policy_number,group_number,submission_date,treatment_date,status,payer_type,treatment_codes,expected_amount';

const row = (claimNumber: string, n: number) =>
  `${claimNumber},Test,Patient${n},Sun Life,D1110,120.00,120.00,45,1985-06-12,SUB${n},GRP1,2026-08-20,2026-08-10,Pending,PRIVATE,D1110,100.00`;

const csv = (claimNumbers: string[]) => [HEADER, ...claimNumbers.map((c, i) => row(c, i + 1))].join('\n');

describe.skipIf(!dbReady)('full export confirmation (real Postgres)', () => {
  let setup: Awaited<ReturnType<typeof createPracticeWithOwnerForTests>>;
  const tag = `FX${Date.now().toString(36)}`;
  const all = ['A', 'B', 'C', 'D'].map((s) => `${tag}-${s}`);

  const cookie = () =>
    `${COOKIE_NAME}=${signUserToken({ userId: setup.user.id, practiceId: setup.practice.id, role: 'practice_owner' })}`;

  const upload = (path: string, claimNumbers: string[], fields: Record<string, string> = {}) => {
    let req = request(app).post(path).set('Cookie', cookie());
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req.attach('file', Buffer.from(csv(claimNumbers)), { filename: 'claims.csv', contentType: 'text/csv' });
  };

  const stopped = async () =>
    prisma.insuranceClaim.count({ where: { practiceId: setup.practice.id, recoveryRoute: 'STOP' } });

  beforeAll(async () => {
    setup = await createPracticeWithOwnerForTests(prisma);
  }, 30_000);

  beforeEach(async () => {
    await prisma.callQueue.deleteMany({ where: { practiceId: setup.practice.id } });
    await prisma.claimRecoveryEvent.deleteMany({ where: { practiceId: setup.practice.id } });
    await prisma.insuranceClaim.deleteMany({ where: { practiceId: setup.practice.id } });
    const seeded = await upload('/api/admin/sync/import/other', all, { exportScope: 'partial' });
    expect(seeded.status).toBe(200);
    expect(await stopped()).toBe(0);
  }, 30_000);

  afterAll(async () => {
    await prisma.callQueue.deleteMany({ where: { practiceId: setup.practice.id } });
    await prisma.claimRecoveryEvent.deleteMany({ where: { practiceId: setup.practice.id } });
    await prisma.insuranceClaim.deleteMany({ where: { practiceId: setup.practice.id } });
    await cleanupPracticeWithUsers(prisma, setup.practice.id);
  });

  it('the preview counts the open claims a file does not list and changes nothing', async () => {
    const res = await upload('/api/admin/sync/import/other/absence-preview', [all[0]]);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ openClaims: 4, missingClaims: 3, wouldHold: false });
    expect(res.body.data.sampleClaimNumbers).toHaveLength(3);
    expect(await stopped()).toBe(0);
    expect(await prisma.claimRecoveryEvent.count({ where: { practiceId: setup.practice.id } })).toBe(0);
  }, 30_000);

  it('applies exactly the confirmed count: the same claims the preview named stop being called', async () => {
    const preview = await upload('/api/admin/sync/import/other/absence-preview', [all[0], all[1]]);
    const confirmed = preview.body.data.missingClaims as number;
    expect(confirmed).toBe(2);
    const res = await upload('/api/admin/sync/import/other', [all[0], all[1]], {
      exportScope: 'full',
      confirmedMissingCount: String(confirmed),
    });
    expect(res.status).toBe(200);
    expect(res.body.claimsClosedAsMissing).toBe(2);
    expect(await stopped()).toBe(2);
    const listed = await prisma.insuranceClaim.findMany({
      where: { practiceId: setup.practice.id, recoveryRoute: 'STOP' },
      select: { claimNumber: true },
    });
    expect(listed.map((c) => c.claimNumber).sort()).toEqual([all[2], all[3]]);
  }, 30_000);

  it('rejects a stale confirmation with 409 and imports nothing', async () => {
    const res = await upload('/api/admin/sync/import/other', [all[0]], {
      exportScope: 'full',
      confirmedMissingCount: '1',
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ABSENT_CLAIMS_CHANGED');
    expect(await stopped()).toBe(0);
  }, 30_000);

  it('a partial export never changes missing claims, and no confirmation is needed', async () => {
    const res = await upload('/api/admin/sync/import/other', [all[0]], { exportScope: 'partial' });
    expect(res.status).toBe(200);
    expect(await stopped()).toBe(0);
  }, 30_000);

  it('the mass-absence guard still holds a filtered file even when it was confirmed', async () => {
    const many = Array.from({ length: 12 }, (_, i) => `${tag}-M${i}`);
    await prisma.callQueue.deleteMany({ where: { practiceId: setup.practice.id } });
    await prisma.insuranceClaim.deleteMany({ where: { practiceId: setup.practice.id } });
    expect((await upload('/api/admin/sync/import/other', many, { exportScope: 'partial' })).status).toBe(200);

    const preview = await upload('/api/admin/sync/import/other/absence-preview', [many[0]]);
    expect(preview.body.data).toMatchObject({ missingClaims: 11, wouldHold: true });
    const res = await upload('/api/admin/sync/import/other', [many[0]], {
      exportScope: 'full',
      confirmedMissingCount: '11',
    });
    expect(res.status).toBe(200);
    expect(res.body.claimsClosedAsMissing).toBe(0);
    expect(res.body.missingClaimsWarning).toMatch(/no claims were closed/);
    expect(await stopped()).toBe(0);
  }, 30_000);
});
