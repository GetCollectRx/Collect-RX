/**
 * The aging report upload: a file with a required column missing, empty or ambiguous is refused whole,
 * nothing is imported, and staff are told why. A sound file imports. The check-only endpoint never imports.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../src/server/index.js';
import { COOKIE_NAME, signUserToken } from '../src/server/authToken.js';
import { runWithRlsBypass } from '../src/server/db/rlsContext.js';
import { cleanupPracticeWithUsers, createPracticeForTests, createUserForTests } from './factories/practice.js';

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

const HEADER = 'claim_number,insurance_carrier,patient_first_name,patient_last_name,patient_dob,subscriber_id,amount_outstanding,days_outstanding';
const ROW = 'AGE-1,Manulife,Zephyrine,Quillfeather,1984-03-17,9900002277,742.50,45';
const GOOD = `${HEADER}\n${ROW}\n`;

describe.skipIf(!dbReady)('aging report upload', () => {
  it('refuses a bad file whole, imports a sound one, and a dry run imports nothing', async () => {
    const practice = await createPracticeForTests(prisma);
    const owner = await createUserForTests(prisma, practice.id, 'practice_owner');
    const cookie = `${COOKIE_NAME}=${signUserToken({ userId: owner.id, practiceId: practice.id, role: 'practice_owner' })}`;
    const upload = (path: string, csv: string) => request(app).post(path).set('Cookie', cookie).attach('file', Buffer.from(csv), 'aging.csv');
    const claimCount = () => prisma.insuranceClaim.count({ where: { practiceId: practice.id } });
    try {
      const missing = GOOD.replace('patient_dob,', '').replace('1984-03-17,', '');
      const refused = await upload('/api/admin/sync/import/auto', missing);
      expect(refused.status).toBe(422);
      expect(refused.body.code).toBe('AGING_REPORT_REJECTED');
      expect(refused.body.problems.map((p: { code: string; field: string }) => `${p.code}:${p.field}`)).toEqual(['MISSING_COLUMN:patient_dob']);
      expect(Array.isArray(refused.body.spec)).toBe(true);
      expect(await claimCount()).toBe(0);

      const empty = GOOD.replace('1984-03-17', '');
      const emptyRefused = await upload('/api/admin/sync/import/auto', empty);
      expect(emptyRefused.status).toBe(422);
      expect(emptyRefused.body.problems[0].code).toBe('EMPTY_COLUMN');

      const dryRun = await upload('/api/admin/sync/import-check', GOOD);
      expect(dryRun.status).toBe(200);
      expect(dryRun.body.data).toMatchObject({ accepted: true, rowCount: 1 });
      expect(await claimCount()).toBe(0);

      const dryRunBad = await upload('/api/admin/sync/import-check', missing);
      expect(dryRunBad.body.data.accepted).toBe(false);

      const accepted = await upload('/api/admin/sync/import/auto', GOOD);
      expect(accepted.status).toBe(200);
      expect(accepted.body.imported).toBe(1);
      expect(await claimCount()).toBe(1);

      // The rejection raised a notification for staff (sent after the response, so wait for it).
      await vi.waitFor(async () => {
        const notices = await runWithRlsBypass(() => prisma.practiceNotification.count({ where: { practiceId: practice.id, type: 'PMS_IMPORT_FAILED' } }));
        expect(notices).toBeGreaterThanOrEqual(2);
      });

      const spec = await request(app).get('/api/admin/sync/aging-report-spec').set('Cookie', cookie);
      expect(spec.status).toBe(200);
      expect(spec.body.data.templateHeader.split(',')).toContain('subscriber_id');
    } finally {
      await runWithRlsBypass(async () => {
        await prisma.practiceNotification.deleteMany({ where: { practiceId: practice.id } });
        await prisma.insuranceClaim.deleteMany({ where: { practiceId: practice.id } });
      });
      await cleanupPracticeWithUsers(prisma, practice.id);
    }
  });
});
