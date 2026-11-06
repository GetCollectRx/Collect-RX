/**
 * Regression: a terminal call outcome revokes the claim's PHI token during
 * desk processing. The end-of-call transcript must already be stored, with
 * known-value redaction, before that happens; afterwards only pattern
 * redaction is possible and patient names survive it. A redelivered report
 * must not overwrite the redacted transcript.
 *
 * Real database, real webhook route, synthetic data only. Outbound HTTP is
 * intercepted so recording-deletion calls never leave the process.
 */
import { createHmac } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generatePracticeBundle } from '../../tools/phi-guard/src/synthetic/factory.js';
import { piiVault } from '../src/pii-vault.js';
import { parseSimpleCsv } from '../src/server/csv/parseSimple.js';
import { runPmsImportPipeline } from '../src/server/pms/pmsImportPipeline.js';
import vapiWebhookRouter from '../src/webhooks/vapi.js';
import { OutboundInterceptor } from './sim-harness/outboundInterceptor.js';

const previousPhiKey = process.env.PHI_ENCRYPTION_KEY;
process.env.PHI_ENCRYPTION_KEY = '33'.repeat(32);

const plain = new PrismaClient();
let dbReady = false;
try {
  await plain.$connect();
  await plain.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (error) {
  console.warn('[transcript PHI ordering] DATABASE_URL unreachable, test skipped:', (error as Error).message);
}

const bundle = generatePracticeBundle('synthetic_claim_standard', 'transcript-phi-order', 4);
const practiceId = bundle.practice.id;
const interceptor = new OutboundInterceptor();
const app = express();
app.use('/api/webhooks/vapi', express.raw({ type: 'application/json' }), vapiWebhookRouter);
const VAPI_CALL_ID = 'phi-order-call-001';

async function post(envelope: Record<string, unknown>): Promise<number> {
  const raw = JSON.stringify(envelope);
  const signature = `sha256=${createHmac('sha256', process.env.VAPI_WEBHOOK_SECRET ?? '').update(raw).digest('hex')}`;
  const res = await request(app)
    .post('/api/webhooks/vapi')
    .set('Content-Type', 'application/json')
    .set('x-vapi-signature', signature)
    .send(raw);
  return res.status;
}

async function cleanup(): Promise<void> {
  const claimIds = (await plain.insuranceClaim.findMany({ where: { practiceId }, select: { id: true } })).map((c) => c.id);
  const markers = [practiceId, VAPI_CALL_ID, ...claimIds];
  const tables = await plain.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
  const patterns = markers.map((m) => `%${m}%`);
  for (let pass = 0; pass < 12; pass += 1) {
    let deleted = 0;
    for (const { table_name: table } of tables) {
      try {
        deleted += await plain.$executeRawUnsafe(
          `DELETE FROM "${table.replace(/"/gu, '')}" x WHERE x::text LIKE ANY($1::text[])`,
          patterns,
        );
      } catch {
        // A row still referenced by another table is removed on a later pass.
      }
    }
    if (deleted === 0) break;
  }
}

describe.skipIf(!dbReady)('end-of-call transcript is stored before the PHI token is revoked', () => {
  let claimId = '';
  let patientToken = '';
  let patientName = '';
  let metadata: Record<string, unknown> = {};

  beforeAll(async () => {
    interceptor.install();
    await cleanup();
    await plain.practice.create({
      data: {
        id: practiceId,
        name: bundle.practice.name,
        timezone: bundle.practice.timezone,
        passwordHash: 'synthetic-test-password-hash',
        billingPhone: bundle.practice.billingPhone,
        practiceAddress: bundle.practice.practiceAddress,
        npi: bundle.practice.registrationNumber,
      },
    });
    piiVault.useStore(plain);
    await runPmsImportPipeline(plain, { practiceId, pmsSource: 'other', rows: parseSimpleCsv(bundle.csv.clean) });
    const record = bundle.cleanRecords[0];
    if (!record) throw new Error('synthetic bundle produced no records');
    patientName = `${record.claim.patient_first_name} ${record.claim.patient_last_name}`;
    const claim = await plain.insuranceClaim.findUniqueOrThrow({
      where: { practiceId_claimNumber: { practiceId, claimNumber: record.claim.claim_number } },
    });
    claimId = claim.id;
    patientToken = claim.patientToken;
    metadata = { claimId, practiceId, carrierId: claim.carrierId, patientToken };
    await plain.callAttempt.create({
      data: { claimId, vapiCallId: VAPI_CALL_ID, initiatedAt: new Date(Date.now() - 20 * 60_000), isHumanAssisted: true, liveState: 'dialing' },
    });
  }, 60_000);

  afterAll(async () => {
    interceptor.uninstall();
    piiVault.expireToken(patientToken, 'transcript-phi-order-cleanup');
    await cleanup();
    await plain.$disconnect().catch(() => undefined);
    if (previousPhiKey === undefined) delete process.env.PHI_ENCRYPTION_KEY;
    else process.env.PHI_ENCRYPTION_KEY = previousPhiKey;
  }, 60_000);

  it('redacts the patient name on a terminal outcome and keeps the redacted copy on redelivery', async () => {
    const call = { id: VAPI_CALL_ID, assistantOverrides: { metadata } };
    const logStatus = await post({
      message: {
        type: 'tool-calls',
        call,
        toolWithToolCallList: [{
          name: 'log_call_outcome',
          toolCall: {
            id: 'log-1',
            function: {
              name: 'log_call_outcome',
              arguments: JSON.stringify({
                scenario: 'CLAIM_PAID',
                callSummary: 'Rep confirmed the claim was paid in full.',
                repName: 'Rep Test',
                referenceNumber: 'REF-PHI-ORDER-1',
                matchesExpectedAmount: true,
              }),
            },
          },
        }],
      },
    });
    expect(logStatus).toBe(200);

    const startedAt = new Date(Date.now() - 20 * 60_000).toISOString();
    const transcript = `Rep: Can I have the patient name?\nStaff: The patient is ${patientName}.\nRep: That claim was paid in full. Reference REF-PHI-ORDER-1.`;
    const endOfCall = (variant: string): Record<string, unknown> => ({
      message: {
        type: 'end-of-call-report',
        startedAt,
        endedAt: new Date().toISOString(),
        endedReason: variant,
        call,
        artifact: { transcript },
        analysis: { summary: 'Paid in full.' },
      },
    });

    expect(await post(endOfCall('customer-ended-call'))).toBe(200);

    const claimAfter = await plain.insuranceClaim.findUniqueOrThrow({ where: { id: claimId } });
    expect(claimAfter.status).toBe('RESOLVED');
    expect(piiVault.detokenize(patientToken, 'transcript-phi-order', { practiceId }).success).toBe(false);

    const stored = await plain.callAttempt.findUniqueOrThrow({ where: { vapiCallId: VAPI_CALL_ID } });
    expect(stored.transcriptText).toBeTruthy();
    expect(stored.transcriptText?.toLowerCase()).not.toContain(patientName.toLowerCase());

    // A different body (new delivery hash) arriving after revocation must not
    // replace the name-redacted transcript.
    expect(await post(endOfCall('assistant-ended-call'))).toBe(200);
    const afterRedelivery = await plain.callAttempt.findUniqueOrThrow({ where: { vapiCallId: VAPI_CALL_ID } });
    expect(afterRedelivery.transcriptText).toBe(stored.transcriptText);
    expect(interceptor.blocked()).toHaveLength(0);
  }, 60_000);
});

afterAll(async () => {
  if (!dbReady) {
    await plain.$disconnect().catch(() => undefined);
    if (previousPhiKey === undefined) delete process.env.PHI_ENCRYPTION_KEY;
    else process.env.PHI_ENCRYPTION_KEY = previousPhiKey;
  }
});
