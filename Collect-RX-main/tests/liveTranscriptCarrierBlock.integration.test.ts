/**
 * Live (mid-call) CARRIER_BLOCK: a final transcript line from the carrier
 * side that refuses automated callers must block the carrier and hang up the
 * call through its control URL while the call is still live. The stored live
 * line must have the patient's name redacted. The assistant's own speech must
 * never trigger a block.
 *
 * Real database, real webhook route, synthetic data only. Outbound HTTP is
 * intercepted: the interceptor answers GET /call/{id} with a control URL and
 * records control commands, so nothing leaves the process.
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
process.env.PHI_ENCRYPTION_KEY = '55'.repeat(32);
// The hang-up reads the control URL with GET /call/{id}, which needs a key;
// the request is intercepted and never sent.
process.env.VAPI_API_KEY = 'live-block-placeholder-not-a-key';

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
  console.warn('[live transcript block] DATABASE_URL unreachable, test skipped:', (error as Error).message);
}

const bundle = generatePracticeBundle('synthetic_claim_standard', 'live-transcript-block', 4);
const practiceId = bundle.practice.id;
const interceptor = new OutboundInterceptor();
const app = express();
app.use('/api/webhooks/vapi', express.raw({ type: 'application/json' }), vapiWebhookRouter);
const AGENT_CALL = 'live-block-agent-001';
const REFUSAL_CALL = 'live-block-refusal-001';

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
  const markers = [practiceId, AGENT_CALL, REFUSAL_CALL, ...claimIds];
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

describe.skipIf(!dbReady)('live transcript lines fire CARRIER_BLOCK mid-call', () => {
  const tokens: string[] = [];
  let patientName = '';
  let carrierId = '';
  const metadataFor = new Map<string, Record<string, unknown>>();

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
    const [first, second] = bundle.cleanRecords;
    if (!first || !second) throw new Error('synthetic bundle produced too few records');
    patientName = `${second.claim.patient_first_name} ${second.claim.patient_last_name}`;
    for (const [record, vapiCallId] of [[first, AGENT_CALL], [second, REFUSAL_CALL]] as const) {
      const claim = await plain.insuranceClaim.findUniqueOrThrow({
        where: { practiceId_claimNumber: { practiceId, claimNumber: record.claim.claim_number } },
      });
      tokens.push(claim.patientToken);
      if (vapiCallId === REFUSAL_CALL) carrierId = claim.carrierId;
      metadataFor.set(vapiCallId, { claimId: claim.id, practiceId, carrierId: claim.carrierId, patientToken: claim.patientToken });
      await plain.callAttempt.create({
        data: { claimId: claim.id, vapiCallId, initiatedAt: new Date(), isHumanAssisted: true, liveState: 'on_hold' },
      });
    }
  }, 60_000);

  afterAll(async () => {
    interceptor.uninstall();
    for (const token of tokens) piiVault.expireToken(token, 'live-transcript-block-cleanup');
    await cleanup();
    await plain.$disconnect().catch(() => undefined);
    restoreEnv();
  }, 60_000);

  it("ignores the assistant's own speech", async () => {
    const status = await post({
      message: {
        type: 'transcript',
        role: 'assistant',
        transcriptType: 'final',
        transcript: "I'm ending this call now.",
        call: { id: AGENT_CALL, assistantOverrides: { metadata: metadataFor.get(AGENT_CALL) } },
      },
    });
    expect(status).toBe(200);
    expect(await plain.callTranscriptLine.count({ where: { vapiCallId: AGENT_CALL } })).toBe(0);
    expect(await plain.carrierBlockEvent.count({ where: { practiceId, resumedAt: null } })).toBe(0);
  }, 60_000);

  it('blocks the carrier, hangs up through the control URL and stores the line without the patient name', async () => {
    const status = await post({
      message: {
        type: 'transcript',
        role: 'user',
        transcriptType: 'final',
        transcript: `Is this about ${patientName}? We do not accept automated calls. I am ending this call.`,
        call: { id: REFUSAL_CALL, assistantOverrides: { metadata: metadataFor.get(REFUSAL_CALL) } },
      },
    });
    expect(status).toBe(200);

    const block = await plain.carrierBlockEvent.findFirst({ where: { practiceId, carrierId, resumedAt: null } });
    expect(block).not.toBeNull();

    const endCalls = interceptor.controlCommands('end-call').filter((r) => r.path === `/${REFUSAL_CALL}/control`);
    expect(endCalls).toHaveLength(1);

    const lines = await plain.callTranscriptLine.findMany({ where: { vapiCallId: REFUSAL_CALL } });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text.toLowerCase()).not.toContain(patientName.toLowerCase());
    expect(interceptor.blocked()).toHaveLength(0);
  }, 60_000);

  it('still deletes the recording, records duration, meters and logs the disclosure when the hung-up call reports its end', async () => {
    const callSeconds = 380;
    const endedAt = new Date();
    const report = (endedReason: string): Record<string, unknown> => ({
      message: {
        type: 'end-of-call-report',
        startedAt: new Date(endedAt.getTime() - callSeconds * 1000).toISOString(),
        endedAt: endedAt.toISOString(),
        endedReason,
        call: { id: REFUSAL_CALL, assistantOverrides: { metadata: metadataFor.get(REFUSAL_CALL) } },
        artifact: { transcript: 'Rep: We do not accept automated calls. I am ending this call.' },
        analysis: { summary: 'Representative refused the automated call.' },
      },
    });
    const deletions = (): number =>
      interceptor.requests.filter((r) => r.disposition === 'recording_delete_stub' && r.path.includes(REFUSAL_CALL)).length;

    expect(await post(report('assistant-ended-call'))).toBe(200);
    const attempt = await plain.callAttempt.findUniqueOrThrow({ where: { vapiCallId: REFUSAL_CALL } });
    expect(attempt.outcome).toBe('BLOCK_DETECTED');
    expect(attempt.durationSeconds).toBe(callSeconds);
    expect(attempt.minutesBilled).toBe(Math.ceil(callSeconds / 60));
    expect(deletions()).toBeGreaterThan(0);
    const disclosure = await plain.auditLog.count({
      where: { practiceId, subjectId: attempt.id, action: { in: ['ADAD_DISCLOSURE_VERIFIED', 'ADAD_DISCLOSURE_UNVERIFIED'] } },
    });
    expect(disclosure).toBe(1);

    // A redelivered report must not delete again, bill again or log again.
    const deletionsBefore = deletions();
    expect(await post(report('customer-ended-call'))).toBe(200);
    const after = await plain.callAttempt.findUniqueOrThrow({ where: { vapiCallId: REFUSAL_CALL } });
    expect(after.minutesBilled).toBe(attempt.minutesBilled);
    expect(deletions()).toBe(deletionsBefore);
    expect(await plain.auditLog.count({
      where: { practiceId, subjectId: attempt.id, action: { in: ['ADAD_DISCLOSURE_VERIFIED', 'ADAD_DISCLOSURE_UNVERIFIED'] } },
    })).toBe(1);
  }, 60_000);
});

afterAll(async () => {
  if (!dbReady) {
    await plain.$disconnect().catch(() => undefined);
    restoreEnv();
  }
});
