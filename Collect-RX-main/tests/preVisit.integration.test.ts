/**
 * Pre-visit platform integration tests — CSV import, deadlines API, webhook pipeline.
 * Requires DATABASE_URL (skipped when unreachable).
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { app, prisma } from '../src/server/index.js';
import { COOKIE_NAME, signUserToken } from '../src/server/authToken.js';
import { processPreVisitCallEnded } from '../src/server/preVisit/preVisitWebhook.js';
import { buildPreVisitDeniedPayload } from './fixtures/preVisitWebhooks.js';
import {
  createPracticeForTests,
  createUserInPracticeForTests,
  cleanupPracticeWithUsers,
} from './factories/practice.js';
import { runWithPracticeRls } from '../src/server/db/rlsContext.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn(
    '[preVisit.integration] DATABASE_URL unreachable — tests skipped:',
    (e as Error).message,
  );
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

/** Owner session backed by a real User row — authentication re-checks the subject. */
async function ownerCookie(practiceId: string): Promise<string> {
  const user = await createUserInPracticeForTests(prisma as unknown as PrismaClient, practiceId);
  return `${COOKIE_NAME}=${signUserToken({
    userId: user.id,
    practiceId,
    role: 'practice_owner',
  })}`;
}

async function cleanupPreVisitFixture(client: PrismaClient, practiceId: string) {
  await client.emrSyncOutbox.deleteMany({ where: { practiceId } });
  await client.adjudicationEvent.deleteMany({ where: { practiceId } });
  await client.scheduledAppointment.deleteMany({ where: { practiceId } });
  await client.appointmentVerification.deleteMany({ where: { practiceId } });
  await client.cdcpReconsiderationCase.deleteMany({ where: { practiceId } });
  await cleanupPracticeWithUsers(client, practiceId);
}

// Denial dates are generated relative to "now" (10 to 30 days ago) instead of
// hardcoded absolute dates. The CDCP reconsideration window is 60 days
// (RECONSIDERATION_WINDOW_DAYS in canadianExpansion/constants.ts). A static
// CSV with fixed 2026 dates silently expired one row at a time as real time
// passed the denialDate + 60 mark, breaking this test starting around
// 2026-06-30 with no code change involved. Relative dates keep every row
// inside the window indefinitely.
function buildSampleCdcpCsv(): string {
  const header = 'claim_ref,patient_token,procedure_code,denial_date,clinical_evidence_summary';
  const daysAgo = (n: number): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const rows = [
    `PD-IMPORT-001,00000000-0000-4000-8000-000000000001,D2750,${daysAgo(30)},Denied — missing periapical radiograph (F-010). Crown predet.`,
    `PD-IMPORT-002,00000000-0000-4000-8000-000000000002,D2740,${daysAgo(25)},Denied — insufficient clinical narrative for crown (F-010).`,
    `PD-IMPORT-003,00000000-0000-4000-8000-000000000003,D5110,${daysAgo(20)},Denied — complete denture predet; treatment plan not on file (F-010).`,
    `PD-IMPORT-004,00000000-0000-4000-8000-000000000004,D4341,${daysAgo(15)},Denied — periodontal charting required for scaling (F-010).`,
    `PD-IMPORT-005,00000000-0000-4000-8000-000000000005,D6010,${daysAgo(10)},Denied — implant surgical predet; missing bitewing radiograph (F-010).`,
  ];
  return [header, ...rows].join('\n');
}

describe.skipIf(!dbReady)('Pre-visit integration — CDCP predet CSV import', () => {
  it('POST /api/pre-visit/cdcp-predets/import ingests sample CSV', async () => {
    const practice = await createPracticeForTests(prisma);
    const cookie = await ownerCookie(practice.id);
    const csv = buildSampleCdcpCsv();

    const res = await request(app)
      .post('/api/pre-visit/cdcp-predets/import')
      .set('Cookie', cookie)
      .set('Content-Type', 'text/csv')
      .send(csv);

    expect(res.status).toBe(200);
    expect(res.body.created).toBeGreaterThanOrEqual(5);

    const deadlines = await request(app)
      .get('/api/pre-visit/cdcp-deadlines')
      .set('Cookie', cookie);

    expect(deadlines.status).toBe(200);
    expect(deadlines.body.cases.length).toBeGreaterThanOrEqual(5);

    await cleanupPreVisitFixture(prisma, practice.id);
  }, 30000);
});

describe.skipIf(!dbReady)('Pre-visit integration — synthetic webhook pipeline', () => {
  it('processPreVisitCallEnded updates verification and writes adjudication event', async () => {
    const practice = await createPracticeForTests(prisma);
    await prisma.practice.update({
      where: { id: practice.id },
      data: { recoveryMode: 'PMS_WRITEBACK' },
    });
    const patientToken = crypto.randomUUID();
    const verification = await runWithPracticeRls(practice.id, () =>
      prisma.appointmentVerification.create({
        data: {
          practiceId: practice.id,
          patientToken,
          carrierId: 'sun_life',
          procedureCodes: ['D2750'],
          appointmentAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
          status: 'YELLOW',
          reason: 'cdcp_predet_pending',
          missingArtifacts: ['periapical_xray'],
          attemptCount: 1,
        },
      }),
    );

    const payload = buildPreVisitDeniedPayload({
      call: { id: `vapi-previsit-int-${Date.now()}` },
      metadata: {
        appointmentVerificationId: verification.id,
        practiceId: practice.id,
        patientToken,
        carrierId: 'sun_life',
        preVisitType: 'cdcp_predet',
        cdcpContext: true,
      },
    });

    const handled = await processPreVisitCallEnded(payload, prisma);
    expect(handled).toBe(true);

    const updated = await runWithPracticeRls(practice.id, () =>
      prisma.appointmentVerification.findUnique({
        where: { id: verification.id },
      }),
    );
    expect(updated?.status).toBe('RED');
    expect(updated?.reason).toBe('cdcp_predet_denied');

    const events = await runWithPracticeRls(practice.id, () =>
      prisma.adjudicationEvent.findMany({
        where: { appointmentVerificationId: verification.id },
      }),
    );
    expect(events.length).toBeGreaterThanOrEqual(1);

    const outbox = await runWithPracticeRls(practice.id, () =>
      prisma.emrSyncOutbox.findMany({
        where: { practiceId: practice.id, claimId: `pre-visit:${verification.id}` },
      }),
    );
    expect(outbox.length).toBeGreaterThanOrEqual(1);

    await cleanupPreVisitFixture(prisma, practice.id);
  }, 30000);
});
