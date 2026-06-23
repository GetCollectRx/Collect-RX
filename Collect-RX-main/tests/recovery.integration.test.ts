/**
 * Recovery loop integration tests — HTTP routes, webhook idempotency, CDCP Prisma queue.
 * Requires DATABASE_URL (skipped when unreachable, same pattern as app.integration.test.ts).
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import type { VapiWebhookPayload } from '../src/vapi/client.js';
import { app, prisma } from '../src/server/index.js';
import { COOKIE_NAME, signUserToken } from '../src/server/authToken.js';
import {
  hashWebhookBody,
  isWebhookDuplicate,
  markWebhookProcessed,
  processRecoveryCallEnded,
} from '../src/server/vapi/vapiWebhook.js';
import { createPracticeForTests, cleanupPracticeWithUsers } from './factories/practice.js';

const TEST_VAPI_SECRET = 'whsec_recovery_integration_test_secret';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn(
    '[recovery.integration] DATABASE_URL unreachable — tests skipped:',
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

async function cleanupRecoveryFixture(client: PrismaClient, practiceId: string) {
  const claims = await client.insuranceClaim.findMany({
    where: { practiceId },
    select: { id: true },
  });
  const claimIds = claims.map((c) => c.id);
  if (claimIds.length > 0) {
    await client.callAttempt.deleteMany({ where: { claimId: { in: claimIds } } });
    await client.callQueue.deleteMany({ where: { claimId: { in: claimIds } } });
    await client.insuranceClaim.deleteMany({ where: { id: { in: claimIds } } });
  }
  await client.cdcpReconsiderationCase.deleteMany({ where: { practiceId } });
  await cleanupPracticeWithUsers(client, practiceId);
}

function buildCallEndedPayload(vapiCallId: string): VapiWebhookPayload {
  return {
    type: 'call.ended',
    call: { id: vapiCallId, status: 'completed', durationSeconds: 45, endedAt: new Date().toISOString() },
    transcript: 'No answer — line busy.',
    metadata: {
      claimId: 'unused',
      carrierId: 'sun_life',
      patientToken: 'unused',
      practiceId: 'unused',
      collectrx: {
        schemaVersion: 1,
        callOutcome: 'NO_ANSWER',
        outcomeDetail: 'Busy signal',
        carrierBlockDetected: false,
      },
    },
  };
}

describe.skipIf(!dbReady)('Recovery integration — webhook idempotency', () => {
  it('body-hash duplicate is detected before processing', async () => {
    const body = Buffer.from(JSON.stringify({ type: 'status-update', call: { id: 'noop' } }), 'utf8');
    const hash = hashWebhookBody(body);

    expect(await isWebhookDuplicate(prisma, hash)).toBe(false);
    await markWebhookProcessed(prisma, hash);
    expect(await isWebhookDuplicate(prisma, hash)).toBe(true);

    await prisma.processedVapiWebhook.delete({ where: { bodyHash: hash } }).catch(() => undefined);
  });

  it('POST /api/webhooks/vapi rejects missing signature', async () => {
    const prev = process.env.VAPI_WEBHOOK_SECRET;
    process.env.VAPI_WEBHOOK_SECRET = TEST_VAPI_SECRET;

    const res = await request(app)
      .post('/api/webhooks/vapi')
      .set('Content-Type', 'application/json')
      .send(Buffer.from('{}'));

    expect(res.status).toBe(401);

    if (prev === undefined) delete process.env.VAPI_WEBHOOK_SECRET;
    else process.env.VAPI_WEBHOOK_SECRET = prev;
  });
});

describe.skipIf(!dbReady)('Recovery integration — call.ended replay', () => {
  it('processRecoveryCallEnded is idempotent per vapiCallId', async () => {
    const practice = await createPracticeForTests(prisma);
    const vapiCallId = `vapi-replay-${Date.now()}`;
    const patientToken = crypto.randomUUID();

    const claim = await prisma.insuranceClaim.create({
      data: {
        practiceId: practice.id,
        carrierId: 'sun_life',
        claimNumber: `CL-${Date.now()}`,
        patientToken,
        billedAmount: 500,
        outstandingAmount: 500,
        daysOutstanding: 45,
        status: 'IN_QUEUE',
        recoveryRoute: 'CALL_CARRIER',
      },
    });

    await prisma.callAttempt.create({
      data: {
        claimId: claim.id,
        vapiCallId,
        initiatedAt: new Date(),
      },
    });

    const payload = buildCallEndedPayload(vapiCallId);
    await processRecoveryCallEnded(payload, prisma, payload);
    await processRecoveryCallEnded(payload, prisma, payload);

    const routeEvents = await prisma.claimRecoveryEvent.count({
      where: { claimId: claim.id, eventType: 'ROUTE_ASSIGNED' },
    });
    expect(routeEvents).toBe(1);

    const attempt = await prisma.callAttempt.findUnique({ where: { vapiCallId } });
    expect(attempt?.outcome).toBe('NO_ANSWER');
    expect(attempt?.completedAt).not.toBeNull();

    await cleanupRecoveryFixture(prisma, practice.id);
  }, 30000);
});

describe.skipIf(!dbReady)('Recovery integration — HTTP routes', () => {
  it('GET /api/insurance/recovery/gates lists blocking gates', async () => {
    const practice = await createPracticeForTests(prisma);
    const cookie = ownerCookie(practice.id);
    const patientToken = crypto.randomUUID();

    const claim = await prisma.insuranceClaim.create({
      data: {
        practiceId: practice.id,
        carrierId: 'sun_life',
        claimNumber: `GATE-${Date.now()}`,
        patientToken,
        billedAmount: 300,
        outstandingAmount: 300,
        daysOutstanding: 60,
        status: 'ON_HOLD',
        recoveryRoute: 'PRACTICE_GATE',
      },
    });

    await prisma.claimRecoveryAction.create({
      data: {
        practiceId: practice.id,
        claimId: claim.id,
        actionType: 'PRACTICE_RESUBMIT',
        status: 'BLOCKING',
        route: 'PRACTICE_GATE',
        title: 'Resubmit with corrected tooth number',
        detail: 'Carrier requested resubmission',
      },
    });

    const res = await request(app)
      .get('/api/insurance/recovery/gates')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.some((g: { claimId: string }) => g.claimId === claim.id)).toBe(true);

    await cleanupRecoveryFixture(prisma, practice.id);
  }, 30000);

  it('POST confirm-payment resolves claim and GET analytics includes syncVerifiedRecovery', async () => {
    const practice = await createPracticeForTests(prisma);
    const cookie = ownerCookie(practice.id);
    const patientToken = crypto.randomUUID();

    const claim = await prisma.insuranceClaim.create({
      data: {
        practiceId: practice.id,
        carrierId: 'sun_life',
        claimNumber: `PAY-${Date.now()}`,
        patientToken,
        billedAmount: 200,
        outstandingAmount: 200,
        daysOutstanding: 30,
        status: 'APPROVED_PENDING_PAYMENT',
        recoveryRoute: 'WAIT_SYNC',
      },
    });

    const confirm = await request(app)
      .post(`/api/insurance/claims/${claim.id}/confirm-payment`)
      .set('Cookie', cookie)
      .send({ notes: 'Check received in office' });

    expect(confirm.status).toBe(200);
    expect(confirm.body.success).toBe(true);
    expect(confirm.body.data.status).toBe('RESOLVED');
    expect(confirm.body.data.recoveryRoute).toBe('STOP');

    const analytics = await request(app)
      .get('/api/analytics/insurance')
      .set('Cookie', cookie);

    expect(analytics.status).toBe(200);
    expect(analytics.body.success).toBe(true);
    expect(analytics.body.data.syncVerifiedRecovery).toBeDefined();
    expect(typeof analytics.body.data.syncVerifiedRecovery.blockingGatesOpen).toBe('number');

    const routeExplain = await request(app)
      .get(`/api/insurance/claims/${claim.id}/route-explanation`)
      .set('Cookie', cookie);

    expect(routeExplain.status).toBe(200);
    expect(routeExplain.body.success).toBe(true);
    expect(routeExplain.body.data.recoveryRoute).toBe('STOP');

    await cleanupRecoveryFixture(prisma, practice.id);
  }, 30000);
});

describe.skipIf(!dbReady)('Recovery integration — CDCP Prisma queue', () => {
  it('GET /api/cdcp/queue reads CdcpReconsiderationCase rows', async () => {
    const practice = await createPracticeForTests(prisma);
    const cookie = ownerCookie(practice.id);
    const claimRef = `CDCP-${Date.now()}`;
    const patientToken = crypto.randomUUID();

    await prisma.cdcpReconsiderationCase.create({
      data: {
        practiceId: practice.id,
        patientToken,
        claimRef,
        procedureCode: '11101',
        denialDate: new Date(Date.now() - 5 * 86_400_000),
        status: 'open',
        clinicalEvidenceSummary: 'T11 denial from PMS sync',
      },
    });

    const res = await request(app).get('/api/cdcp/queue').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(
      res.body.queue.some((item: { record: { claimId: string } }) => item.record.claimId === claimRef),
    ).toBe(true);

    await cleanupRecoveryFixture(prisma, practice.id);
  }, 30000);

  it('PATCH /api/cdcp/reconsiderations/:id updates Prisma case with rotation rules', async () => {
    const practice = await createPracticeForTests(prisma);
    const cookie = ownerCookie(practice.id);
    const patientToken = crypto.randomUUID();

    const cdcpCase = await prisma.cdcpReconsiderationCase.create({
      data: {
        practiceId: practice.id,
        patientToken,
        claimRef: `PATCH-${Date.now()}`,
        procedureCode: '11101',
        denialDate: new Date(Date.now() - 10 * 86_400_000),
        status: 'open',
        originalAdjudicatorHint: 'adj-original',
      },
    });

    const badRotation = await request(app)
      .patch(`/api/cdcp/reconsiderations/${cdcpCase.id}`)
      .set('Cookie', cookie)
      .send({ assignedAdjudicatorId: 'adj-original' });

    expect(badRotation.status).toBe(422);

    const ok = await request(app)
      .patch(`/api/cdcp/reconsiderations/${cdcpCase.id}`)
      .set('Cookie', cookie)
      .send({
        status: 'submitted',
        assignedAdjudicatorId: 'adj-different',
        confirmationNumber: 'CN-12345',
        submissionMethod: 'cdanet_09',
        notes: 'Package filed via CDAnet',
      });

    expect(ok.status).toBe(200);
    expect(ok.body.success).toBe(true);

    const updated = await prisma.cdcpReconsiderationCase.findUnique({ where: { id: cdcpCase.id } });
    expect(updated?.status).toBe('submitted');
    const meta = updated?.metadata as Record<string, string> | null;
    expect(meta?.assignedAdjudicatorId).toBe('adj-different');
    expect(meta?.confirmationNumber).toBe('CN-12345');
    expect(meta?.submissionMethod).toBe('cdanet_09');
    expect(meta?.notes).toBe('Package filed via CDAnet');
    expect(meta?.submittedAt).toBeTruthy();

    await cleanupRecoveryFixture(prisma, practice.id);
  }, 30000);
});
