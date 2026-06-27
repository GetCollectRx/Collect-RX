/**
 * Pre-visit platform integration tests — CSV import, deadlines API, webhook pipeline.
 * Requires DATABASE_URL (skipped when unreachable).
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { app, prisma } from '../src/server/index.js';
import { COOKIE_NAME, signUserToken } from '../src/server/authToken.js';
import { processPreVisitCallEnded } from '../src/server/preVisit/preVisitWebhook.js';
import { buildPreVisitDeniedPayload } from './fixtures/preVisitWebhooks.js';
import { createPracticeForTests, cleanupPracticeWithUsers } from './factories/practice.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE_CSV = join(__dirname, '..', 'sample-cdcp-predets.csv');

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

function ownerCookie(practiceId: string): string {
  return `${COOKIE_NAME}=${signUserToken({
    userId: `owner-${practiceId}`,
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

describe.skipIf(!dbReady)('Pre-visit integration — CDCP predet CSV import', () => {
  it('POST /api/pre-visit/cdcp-predets/import ingests sample CSV', async () => {
    const practice = await createPracticeForTests(prisma);
    const cookie = ownerCookie(practice.id);
    const csv = readFileSync(SAMPLE_CSV, 'utf8');

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
    const patientToken = crypto.randomUUID();
    const verification = await prisma.appointmentVerification.create({
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
    });

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

    const updated = await prisma.appointmentVerification.findUnique({
      where: { id: verification.id },
    });
    expect(updated?.status).toBe('RED');
    expect(updated?.reason).toBe('cdcp_predet_denied');

    const events = await prisma.adjudicationEvent.findMany({
      where: { appointmentVerificationId: verification.id },
    });
    expect(events.length).toBeGreaterThanOrEqual(1);

    const outbox = await prisma.emrSyncOutbox.findMany({
      where: { practiceId: practice.id, claimId: `pre-visit:${verification.id}` },
    });
    expect(outbox.length).toBeGreaterThanOrEqual(1);

    await cleanupPreVisitFixture(prisma, practice.id);
  }, 30000);
});
