/**
 * Regression: a Hold Sentinel call whose end-of-call transcript carries a rep's
 * refusal of automated callers must fire CARRIER_BLOCK, and the block path must
 * still run zero-retention audio deletion, record the call duration, meter the
 * minutes, and write the disclosure audit entry. Before the fix, "We do not
 * accept automated calls" was not detected, and the block path returned before
 * any of those steps.
 *
 * Real database, real webhook route, synthetic data only. Outbound HTTP is
 * intercepted so recording deletion never leaves the process.
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
const previousVapiKey = process.env.VAPI_API_KEY;
process.env.PHI_ENCRYPTION_KEY = '44'.repeat(32);
// Recording deletion only issues its request when a key is configured; the
// request itself is intercepted and never sent.
process.env.VAPI_API_KEY = 'carrier-block-eoc-placeholder-not-a-key';

function restoreEnv(): void {
  if (previousPhiKey === undefined) delete process.env.PHI_ENCRYPTION_KEY;
  else process.env.PHI_ENCRYPTION_KEY = previousPhiKey;
  if (previousVapiKey === undefined) delete process.env.VAPI_API_KEY;
  else process.env.VAPI_API_KEY = previousVapiKey;
}

const plain = new PrismaClient();
let dbReady = false;
try {
  await plain.$connect();
  await plain.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (error) {
  console.warn('[carrier block end of call] DATABASE_URL unreachable, test skipped:', (error as Error).message);
}

const bundle = generatePracticeBundle('synthetic_claim_standard', 'carrier-block-eoc', 4);
const practiceId = bundle.practice.id;
const interceptor = new OutboundInterceptor();
const app = express();
app.use('/api/webhooks/vapi', express.raw({ type: 'application/json' }), vapiWebhookRouter);
const VAPI_CALL_ID = 'block-eoc-call-001';
const CALL_SECONDS = 625;

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

describe.skipIf(!dbReady)('end-of-call refusal fires CARRIER_BLOCK without skipping post-call duties', () => {
  let claimId = '';
  let carrierId = '';
  let patientToken = '';
  let attemptId = '';
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
    const claim = await plain.insuranceClaim.findUniqueOrThrow({
      where: { practiceId_claimNumber: { practiceId, claimNumber: record.claim.claim_number } },
    });
    claimId = claim.id;
    carrierId = claim.carrierId;
    patientToken = claim.patientToken;
    metadata = { claimId, practiceId, carrierId, patientToken };
    const attempt = await plain.callAttempt.create({
      data: { claimId, vapiCallId: VAPI_CALL_ID, initiatedAt: new Date(Date.now() - CALL_SECONDS * 1000), isHumanAssisted: true, liveState: 'dialing' },
    });
    attemptId = attempt.id;
  }, 60_000);

  afterAll(async () => {
    interceptor.uninstall();
    piiVault.expireToken(patientToken, 'carrier-block-eoc-cleanup');
    await cleanup();
    await plain.$disconnect().catch(() => undefined);
    restoreEnv();
  }, 60_000);

  it('blocks the carrier, deletes the recording, records duration, meters minutes and writes the disclosure entry', async () => {
    const endedAt = new Date();
    const startedAt = new Date(endedAt.getTime() - CALL_SECONDS * 1000);
    const status = await post({
      message: {
        type: 'end-of-call-report',
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        endedReason: 'customer-ended-call',
        call: { id: VAPI_CALL_ID, assistantOverrides: { metadata } },
        artifact: { transcript: 'Rep: Is this an automated call? We do not accept automated calls. I am ending this call.' },
        analysis: { summary: 'Representative refused the automated call.' },
      },
    });
    expect(status).toBe(200);

    const block = await plain.carrierBlockEvent.findFirst({ where: { practiceId, carrierId, resumedAt: null } });
    expect(block).not.toBeNull();

    const attempt = await plain.callAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(attempt.outcome).toBe('BLOCK_DETECTED');
    expect(attempt.carrierBlockDetected).toBe(true);
    expect(attempt.completedAt).not.toBeNull();
    expect(attempt.durationSeconds).toBe(CALL_SECONDS);
    expect(attempt.minutesBilled).toBe(Math.ceil(CALL_SECONDS / 60));

    const deletions = interceptor.requests.filter(
      (r) => r.disposition === 'recording_delete_stub' && r.path.includes(VAPI_CALL_ID),
    );
    expect(deletions.length).toBeGreaterThan(0);

    const disclosure = await plain.auditLog.findFirst({
      where: { practiceId, subjectId: attemptId, action: { in: ['ADAD_DISCLOSURE_VERIFIED', 'ADAD_DISCLOSURE_UNVERIFIED'] } },
    });
    expect(disclosure).not.toBeNull();
    expect(interceptor.blocked()).toHaveLength(0);
  }, 60_000);
});

afterAll(async () => {
  if (!dbReady) {
    await plain.$disconnect().catch(() => undefined);
    restoreEnv();
  }
});
