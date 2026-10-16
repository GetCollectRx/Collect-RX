/**
 * DEC-14 slice 2: claims a confirmed full export left out are paused and wait
 * for the practice owner. Real Postgres and the real routes. Skipped with a log
 * line when DATABASE_URL is unreachable, like the other DB-backed suites.
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
  console.warn('[absentClaimReview] DATABASE_URL unreachable, skipping:', (e as Error).message);
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

const HEADER =
  'claim_number,patient_first_name,patient_last_name,carrier_name,procedure_code,amount_billed,amount_outstanding,days_outstanding,patient_dob,policy_number,group_number,submission_date,treatment_date,status,payer_type,treatment_codes,expected_amount';
const row = (claimNumber: string, n: number) =>
  `${claimNumber},Test,Patient${n},Sun Life,D1110,120.00,120.00,45,1985-06-12,SUB${n},GRP1,2026-08-20,2026-08-10,Pending,PRIVATE,D1110,100.00`;
const csv = (claimNumbers: string[]) => [HEADER, ...claimNumbers.map((c, i) => row(c, i + 1))].join('\n');

describe.skipIf(!dbReady)('claims not in the latest file (real Postgres)', () => {
  let setup: Awaited<ReturnType<typeof createPracticeWithOwnerForTests>>;
  let other: Awaited<ReturnType<typeof createPracticeWithOwnerForTests>>;
  const tag = `NL${Date.now().toString(36)}`;
  const nums = ['A', 'B', 'C', 'D'].map((s) => `${tag}-${s}`);

  const cookieFor = (role: string, p = setup) =>
    `${COOKIE_NAME}=${signUserToken({ userId: p.user.id, practiceId: p.practice.id, role: role as 'practice_owner' })}`;
  const owner = () => cookieFor('practice_owner');

  const importCsv = (claimNumbers: string[], fields: Record<string, string>, p = setup) => {
    let req = request(app).post('/api/admin/sync/import/other').set('Cookie', cookieFor('practice_owner', p));
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req.attach('file', Buffer.from(csv(claimNumbers)), { filename: 'claims.csv', contentType: 'text/csv' });
  };
  const list = () => request(app).get('/api/claims-not-in-latest-file').set('Cookie', owner());
  const decide = (claimIds: string[], decision: string, cookie = owner()) =>
    request(app).post('/api/claims-not-in-latest-file/decision').set('Cookie', cookie).send({ claimIds, decision });
  const idOf = async (claimNumber: string, p = setup) =>
    (await prisma.insuranceClaim.findFirstOrThrow({ where: { practiceId: p.practice.id, claimNumber } })).id;

  async function wipe() {
    for (const p of [setup, other]) {
      await prisma.callQueue.deleteMany({ where: { practiceId: p.practice.id } });
      await prisma.claimRecoveryEvent.deleteMany({ where: { practiceId: p.practice.id } });
      await prisma.insuranceClaim.deleteMany({ where: { practiceId: p.practice.id } });
    }
  }

  beforeAll(async () => {
    setup = await createPracticeWithOwnerForTests(prisma);
    other = await createPracticeWithOwnerForTests(prisma);
  }, 30_000);

  beforeEach(async () => {
    await wipe();
    expect((await importCsv(nums, { exportScope: 'partial' })).status).toBe(200);
    // A full file that lists only A and B: C and D are left out and paused.
    const full = await importCsv([nums[0], nums[1]], { exportScope: 'full', confirmedMissingCount: '2' });
    expect(full.status).toBe(200);
    expect(full.body.claimsClosedAsMissing).toBe(2);
  }, 30_000);

  afterAll(async () => {
    await wipe();
    await cleanupPracticeWithUsers(prisma, setup.practice.id);
    await cleanupPracticeWithUsers(prisma, other.practice.id);
  });

  it('lists the paused claims with no patient information', async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.body.data.map((c: { claimNumber: string }) => c.claimNumber)).toEqual([nums[2], nums[3]]);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(
      ['carrierId', 'claimNumber', 'daysOutstanding', 'id', 'notInFileSince', 'outstandingAmount'],
    );
  }, 30_000);

  it('confirming resolved keeps the claim closed and removes it from the list', async () => {
    const id = await idOf(nums[2]);
    const res = await decide([id], 'RESOLVED');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ decided: 1, skipped: [] });
    expect((await prisma.insuranceClaim.findUniqueOrThrow({ where: { id } })).recoveryRoute).toBe('STOP');
    expect((await list()).body.data.map((c: { claimNumber: string }) => c.claimNumber)).toEqual([nums[3]]);
    const latest = await prisma.claimRecoveryEvent.findFirstOrThrow({ where: { claimId: id }, orderBy: { createdAt: 'desc' } });
    expect(latest.eventType).toBe('ABSENT_CONFIRMED_RESOLVED');
    expect(latest.metadata).toMatchObject({ decidedByUserId: setup.user.id });
  }, 30_000);

  it('putting a claim back restores its route and returns it to the call queue', async () => {
    const id = await idOf(nums[3]);
    expect((await decide([id], 'RESTORE')).body.decided).toBe(1);
    expect((await prisma.insuranceClaim.findUniqueOrThrow({ where: { id } })).recoveryRoute).not.toBe('STOP');
    expect((await list()).body.data.map((c: { claimNumber: string }) => c.claimNumber)).toEqual([nums[2]]);
    const latest = await prisma.claimRecoveryEvent.findFirstOrThrow({ where: { claimId: id }, orderBy: { createdAt: 'desc' } });
    expect(latest.eventType).toBe('ABSENT_RESTORED_BY_STAFF');
    expect(await prisma.callQueue.count({ where: { claimId: id } })).toBe(1);
  }, 30_000);

  it('skips claims that are not waiting, including another practice\'s, and changes nothing for them', async () => {
    await importCsv(['OTHER-1'], { exportScope: 'partial' }, other);
    const theirs = await idOf('OTHER-1', other);
    const listed = await idOf(nums[0]); // still open and calling: not awaiting confirmation
    const res = await decide([theirs, listed, 'no-such-claim'], 'RESOLVED');
    expect(res.status).toBe(200);
    expect(res.body.decided).toBe(0);
    expect(res.body.skipped.sort()).toEqual([theirs, listed, 'no-such-claim'].sort());
    expect((await prisma.claimRecoveryEvent.count({ where: { claimId: theirs } }))).toBe(0);
  }, 30_000);

  it('deciding the same claim twice is a no-op the second time', async () => {
    const id = await idOf(nums[2]);
    expect((await decide([id], 'RESOLVED')).body.decided).toBe(1);
    const again = await decide([id], 'RESTORE');
    expect(again.body).toMatchObject({ decided: 0, skipped: [id] });
    expect((await prisma.insuranceClaim.findUniqueOrThrow({ where: { id } })).recoveryRoute).toBe('STOP');
  }, 30_000);

  it('a claim that comes back in a later file with a balance resumes on its own, unless staff already confirmed it', async () => {
    const waiting = await idOf(nums[2]);
    const confirmed = await idOf(nums[3]);
    await decide([confirmed], 'RESOLVED');
    expect((await importCsv([nums[0], nums[1], nums[2], nums[3]], { exportScope: 'partial' })).status).toBe(200);
    expect((await prisma.insuranceClaim.findUniqueOrThrow({ where: { id: waiting } })).recoveryRoute).not.toBe('STOP');
    expect((await prisma.insuranceClaim.findUniqueOrThrow({ where: { id: confirmed } })).recoveryRoute).toBe('STOP');
    expect((await list()).body.data).toEqual([]);
  }, 30_000);

  it('only the practice owner can read or decide: every other role gets 403 and nothing changes', async () => {
    const id = await idOf(nums[2]);
    for (const role of ['office_manager', 'billing_coordinator', 'front_desk', 'accountant', 'associate_dentist']) {
      const read = await request(app).get('/api/claims-not-in-latest-file').set('Cookie', cookieFor(role));
      const write = await decide([id], 'RESOLVED', cookieFor(role));
      expect([role, read.status, write.status]).toEqual([role, 403, 403]);
    }
    expect((await list()).body.data).toHaveLength(2);
  }, 30_000);

  it('validates the request', async () => {
    expect((await decide([], 'RESOLVED')).status).toBe(400);
    expect((await decide(['x'], 'MAYBE')).status).toBe(400);
  }, 30_000);
});
