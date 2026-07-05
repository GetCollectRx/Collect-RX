/**
 * End-to-end workflow: CSV practice onboarding -> admin visibility -> work queue ->
 * call escalation -> front-desk resolution -> aging report.
 *
 * Mirrors the real operator story: a practice with no AbelDent connector onboards via
 * CSV (the primary onboarding path per CLAUDE.md), a platform admin confirms the practice
 * is visible, a claim escalates during a carrier call, and front desk resolves it.
 *
 * DB-dependent — skipped with a warning if DATABASE_URL is unreachable (same convention
 * as tests/app.integration.test.ts and tests/platformDevAccess.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../src/server/index.js';
import { createPracticeWithOwnerForTests, cleanupPracticeWithUsers } from './factories/practice.js';
import { parseSimpleCsv } from '../src/server/csv/parseSimple.js';
import { runPmsImportPipeline } from '../src/server/pms/pmsImportPipeline.js';
import { createEscalation } from '../src/server/services/escalationService.js';

const ADMIN_DEV_PW = 'e2e-lifecycle-admin-pw';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn(
    '[workflowClaimLifecycle] DATABASE_URL unreachable — skipping:',
    (e as Error).message,
  );
}

function extractCookie(res: request.Response): string {
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie ?? '');
  return raw.match(/crx_access=[^;]+/)?.[0] ?? '';
}

describe.skipIf(!dbReady)(
  'End-to-end: onboarding -> admin visibility -> queue -> escalation -> resolution -> aging report',
  () => {
    let practice: Awaited<ReturnType<typeof createPracticeWithOwnerForTests>>['practice'];
    let ownerCookie: string;

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
      await prisma.callEscalation.deleteMany({ where: { practiceId: practice.id } });
      await prisma.workItem.deleteMany({ where: { practiceId: practice.id } });
      await prisma.insuranceClaim.deleteMany({ where: { practiceId: practice.id } });
      await prisma.pmsImportRun.deleteMany({ where: { practiceId: practice.id } });
      await cleanupPracticeWithUsers(prisma, practice.id);
      await prisma.$disconnect().catch(() => undefined);
    });

    it('onboards the practice via CSV import (the primary path for practices without a PMS connector)', async () => {
      const csvText = [
        'claim_number,patient_first_name,patient_last_name,carrier_name,treatment_date,amount_billed,amount_outstanding,days_outstanding,treatment_codes,patient_dob',
        'CLM-E2E-1001,Jane,Doe,Sun Life,2026-02-15,450.00,450.00,45,D1110,1985-06-12',
        'CLM-E2E-1002,John,Smith,Canada Life,2026-03-10,220.00,220.00,20,D0274,1990-01-20',
      ].join('\n');

      const rows = parseSimpleCsv(csvText);
      expect(rows).toHaveLength(2);

      const result = await runPmsImportPipeline(prisma, {
        practiceId: practice.id,
        pmsSource: 'other',
        rows,
      });

      expect(result.status).toBe('success');
      expect(result.validationPassed).toBe(true);
      expect(result.imported).toBe(2);
      expect(result.failed).toBe(0);

      const claims = await prisma.insuranceClaim.findMany({ where: { practiceId: practice.id } });
      expect(claims).toHaveLength(2);
      expect(claims.every((c) => c.patientToken && c.patientToken.length > 0)).toBe(true);
    });

    it('a platform admin (platform-dev session) sees the newly onboarded practice via /api/admin/practices', async () => {
      const prevPw = process.env.PLATFORM_DEV_PASSWORD;
      process.env.PLATFORM_DEV_PASSWORD = ADMIN_DEV_PW;

      const adminLogin = await request(app)
        .post('/api/auth/login/platform-dev')
        .send({ password: ADMIN_DEV_PW });
      expect(adminLogin.status).toBe(200);
      expect(adminLogin.body.userRole ?? adminLogin.body.role).toBeDefined();
      const adminCookie = extractCookie(adminLogin);

      const list = await request(app).get('/api/admin/practices').set('Cookie', adminCookie);
      expect(list.status).toBe(200);
      expect(list.body.data.some((p: { id: string }) => p.id === practice.id)).toBe(true);

      const detail = await request(app)
        .get(`/api/admin/practices/${practice.id}`)
        .set('Cookie', adminCookie);
      expect(detail.status).toBe(200);
      expect(detail.body.data.practice.id).toBe(practice.id);
      expect(detail.body.data.queueStats).toBeDefined();

      if (prevPw === undefined) delete process.env.PLATFORM_DEV_PASSWORD;
      else process.env.PLATFORM_DEV_PASSWORD = prevPw;
    });

    it('the practice owner sees the imported claims in the work queue', async () => {
      const res = await request(app)
        .get(`/api/work-queue?practiceId=${practice.id}`)
        .set('Cookie', ownerCookie);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.items.length).toBeGreaterThanOrEqual(2);
    });

    it('the aging report buckets the imported claims by days outstanding', async () => {
      const res = await request(app)
        .get(`/api/practices/${practice.id}/reports/aging?timeframe=all`)
        .set('Cookie', ownerCookie);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const buckets = res.body.data.buckets as Array<{
        label: string;
        claimCount: number;
        totalAmount: number;
      }>;
      const current = buckets.find((b) => b.label === 'Current'); // <=30 days: the 20-day claim
      const thirtyToSixty = buckets.find((b) => b.label === '31–60'); // the 45-day claim
      expect(current?.claimCount).toBe(1);
      expect(thirtyToSixty?.claimCount).toBe(1);
    });

    it('a carrier call escalates, and front desk resolves it by writing off the claim', async () => {
      const claim = await prisma.insuranceClaim.findFirst({
        where: { practiceId: practice.id, claimNumber: 'CLM-E2E-1001' },
      });
      expect(claim).toBeTruthy();

      // Seed a queue entry so the write-off's queue-removal side effect is actually
      // exercised below (CSV import alone does not create CallQueue rows — those are
      // populated by the recovery loop service, out of scope for this workflow test).
      await prisma.callQueue.create({
        data: { practiceId: practice.id, claimId: claim!.id, scheduledFor: new Date() },
      });

      const escalation = await createEscalation(prisma, {
        practiceId: practice.id,
        claimId: claim!.id,
        claimRef: claim!.claimNumber,
        carrierId: claim!.carrierId,
        amountClaimedCents: Math.round(Number(claim!.outstandingAmount) * 100),
        reason: 'Carrier rep disputed timely filing — needs manual appeal review',
      });

      const listRes = await request(app)
        .get(`/api/calls/${practice.id}/escalations?status=open`)
        .set('Cookie', ownerCookie);
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.some((e: { id: string }) => e.id === escalation.id)).toBe(true);

      const resolveRes = await request(app)
        .put(`/api/calls/${practice.id}/escalations/${escalation.id}`)
        .set('Cookie', ownerCookie)
        .send({
          resolution: 'written_off',
          notes: 'Timely filing window missed; writing off per practice policy',
        });
      expect(resolveRes.status).toBe(200);
      expect(resolveRes.body.data.status).toBe('resolved');
      expect(resolveRes.body.data.resolution).toBe('written_off');

      const updatedClaim = await prisma.insuranceClaim.findUnique({ where: { id: claim!.id } });
      expect(updatedClaim?.status).toBe('DENIED');

      const remainingQueueEntry = await prisma.callQueue.findFirst({ where: { claimId: claim!.id } });
      expect(remainingQueueEntry).toBeNull();
    });
  },
);
