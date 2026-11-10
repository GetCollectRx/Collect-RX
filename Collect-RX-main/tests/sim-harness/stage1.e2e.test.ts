/**
 * Simulation harness, Stage 1 (offline, no keys, no calls, $0).
 *
 * Runs the real product modules against a real PostgreSQL database and a
 * fake carrier made of scripted Vapi server messages. Outbound HTTP is
 * intercepted (decision D1), so the real allowlist guard still runs and no
 * request leaves the process. Lesson extraction is invoked directly on
 * staff-handled calls (decision D2) instead of editing webhooks/vapi.ts.
 *
 * Product checks are recorded in the run log and never throw, so every step
 * reports even when an earlier one fails. Only harness-safety invariants are
 * hard assertions: nothing escaped interception, every dial was accounted
 * for, and teardown left no synthetic data behind. The product verdict lives
 * in the run report.
 */
import { createHmac } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { PrismaClient, type CarrierId } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generatePracticeBundle } from '../../../tools/phi-guard/src/synthetic/factory.js';
import type { SyntheticRecord } from '../../../tools/phi-guard/src/synthetic/generate.js';
import { prisma } from '../../src/lib/prisma.js';
import { piiVault } from '../../src/pii-vault.js';
import * as legacyVault from '../../src/services/pii-vault.js';
import { parseSimpleCsv } from '../../src/server/csv/parseSimple.js';
import { runPmsImportPipeline } from '../../src/server/pms/pmsImportPipeline.js';
import { deriveDaysOutstanding } from '../../src/server/pms/claimAge.js';
import { computeAgeScore } from '../../src/services/priorityScoring.js';
import { runDeskQueueTick } from '../../src/server/frontDesk/queueEngine.js';
import { applyCarrierBlock } from '../../src/server/frontDesk/carrierBlockService.js';
import { CARRIER_PHONE_MAP } from '../../src/vapi/client.js';
import vapiWebhookRouter from '../../src/webhooks/vapi.js';
import { createFrontDeskRouter } from '../../src/server/routes/frontDeskApi.js';
import { signUserToken } from '../../src/server/authToken.js';
import {
  extractLessonsFromCall,
  getApprovedNavigationNotes,
  reviewLesson,
} from '../../src/server/learning/carrierLessons.js';
import { getTimeSaved } from '../../src/services/insurance-analytics.js';
import { defaultPracticeSettings } from '../../src/server/services/practiceSettingsService.js';
import { canMakeCall } from '../../src/server/plans/planBridge.js';
import { OutboundInterceptor, type InterceptedRequest } from './outboundInterceptor.js';
import { buildFakeCall, REP_SCRIPTS, type ScenarioId } from './fakeCarrier.js';
import { RunLog } from './runLog.js';
import { acquireSimLock, releaseSimLock } from './simLock.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CARRIERS_DIR = path.resolve(here, '../../carriers');
const ESCALATION_PHONE = '+16135550150';
const RUN_ID = `stage1-${new Date().toISOString().replace(/[:.]/gu, '-')}`;
const SCENARIO_ORDER: ScenarioId[] = [
  'C1_PAID_IN_FULL',
  'S014_PARTIAL_PAYER',
  'DENIED_WITH_CODE',
  'NOT_ON_FILE_RESUBMIT',
  'ROBOT_REFUSER',
];
const EXPECTED_CLAIM_STATUS: Record<ScenarioId, string> = {
  C1_PAID_IN_FULL: 'RESOLVED',
  S014_PARTIAL_PAYER: 'ESCALATED',
  DENIED_WITH_CODE: 'DENIED',
  NOT_ON_FILE_RESUBMIT: 'ESCALATED',
  ROBOT_REFUSER: 'CARRIER_BLOCK',
};

const ENV_KEYS = [
  'PHI_ENCRYPTION_KEY', 'VAPI_API_KEY', 'VAPI_PHONE_NUMBER_ID', 'VAPI_SQUAD_ID',
  'VAPI_HUMAN_ASSISTED_SQUAD_ID', 'COLLECTRX_FORCE_CALL_WINDOW', 'ANTHROPIC_API_KEY',
  'COLLECTRX_ANTHROPIC_EVAL', 'SENDGRID_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
  'AGENTS_ENABLED', 'JWT_SECRET',
] as const;
const savedEnv = new Map<string, string | undefined>(ENV_KEYS.map((k) => [k, process.env[k]]));

process.env.PHI_ENCRYPTION_KEY = '22'.repeat(32);
process.env.VAPI_API_KEY = 'sim-harness-placeholder-not-a-key';
process.env.VAPI_PHONE_NUMBER_ID = 'sim-harness-phone-number-id';
process.env.VAPI_SQUAD_ID = 'sim-autonomous-squad';
process.env.VAPI_HUMAN_ASSISTED_SQUAD_ID = 'sim-hold-sentinel-squad';
process.env.COLLECTRX_FORCE_CALL_WINDOW = '1';
process.env.ANTHROPIC_API_KEY = 'sim-harness-placeholder-not-a-key';
process.env.COLLECTRX_ANTHROPIC_EVAL = '1';
process.env.JWT_SECRET = 'sim-harness-stage1-jwt-placeholder';
delete process.env.SENDGRID_API_KEY;
delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_AUTH_TOKEN;
delete process.env.AGENTS_ENABLED;

const plain = new PrismaClient();
let dbReady = false;
try {
  await plain.$connect();
  await plain.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (error) {
  console.warn('[sim-harness] DATABASE_URL unreachable, Stage 1 not run (UNVERIFIED):', (error as Error).message);
}

const log = new RunLog(RUN_ID);
const interceptor = new OutboundInterceptor();
const bundle = generatePracticeBundle('synthetic_claim_standard', 'sim-harness-stage1', 10);
const practiceId = bundle.practice.id;
const records: SyntheticRecord[] = bundle.cleanRecords;
const realCarrierDigits = new Set(Object.values(CARRIER_PHONE_MAP).map((n) => n.replace(/\D/gu, '')));
const issuedTokens: string[] = [];
const createdAttemptIds: string[] = [];
const webhookApp = express();
webhookApp.use('/api/webhooks/vapi', express.raw({ type: 'application/json' }), vapiWebhookRouter);
const deskApp = express();
deskApp.use(express.json());
deskApp.use('/api/desk', createFrontDeskRouter());

interface ToolResult { name?: string; result?: string }

function phiValues(): string[] {
  return records.flatMap((r) => [
    `${r.claim.patient_first_name} ${r.claim.patient_last_name}`,
    r.claim.patient_dob,
    r.claim.subscriber_id,
  ]);
}

function phiForClaimNumber(claimNumber: string): { patientName: string; dateOfBirth: string; memberId: string } {
  const r = records.find((x) => x.claim.claim_number === claimNumber);
  if (!r) throw new Error(`[sim-harness] no synthetic record for ${claimNumber}`);
  return {
    patientName: `${r.claim.patient_first_name} ${r.claim.patient_last_name}`,
    dateOfBirth: r.claim.patient_dob,
    memberId: r.claim.subscriber_id,
  };
}

function leaks(text: string | null | undefined): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  return phiValues().filter((v) => lower.includes(v.toLowerCase()));
}

async function tablesWithText(values: string[]): Promise<Array<{ table: string; rows: number }>> {
  const tables = await plain.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
  const patterns = values.map((v) => `%${v.replace(/[%_\\]/gu, (m) => `\\${m}`)}%`);
  const hits: Array<{ table: string; rows: number }> = [];
  for (const { table_name: table } of tables) {
    const rows = await plain.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT count(*)::int AS n FROM "${table.replace(/"/gu, '')}" x WHERE x::text ILIKE ANY($1::text[])`,
      patterns,
    );
    const n = rows[0]?.n ?? 0;
    if (n > 0) hits.push({ table, rows: n });
  }
  return hits;
}

async function postWebhook(envelope: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const raw = JSON.stringify(envelope);
  const secret = process.env.VAPI_WEBHOOK_SECRET ?? '';
  const signature = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  const res = await request(webhookApp)
    .post('/api/webhooks/vapi')
    .set('Content-Type', 'application/json')
    .set('x-vapi-signature', signature)
    .send(raw);
  return { status: res.status, body: res.body as unknown };
}

function toolResults(body: unknown): ToolResult[] {
  if (typeof body !== 'object' || body === null) return [];
  const results = (body as { results?: unknown }).results;
  return Array.isArray(results) ? results.filter((r): r is ToolResult => typeof r === 'object' && r !== null) : [];
}

function dialBody(req: InterceptedRequest): {
  squadId?: string;
  customerNumber?: string;
  metadata?: Record<string, unknown>;
  variables?: Record<string, unknown>;
} {
  if (typeof req.body !== 'object' || req.body === null) return {};
  const b = req.body as {
    squadId?: unknown;
    customer?: { number?: unknown };
    assistantOverrides?: { metadata?: unknown; variableValues?: unknown };
  };
  const asRecord = (v: unknown): Record<string, unknown> | undefined =>
    typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined;
  return {
    squadId: typeof b.squadId === 'string' ? b.squadId : undefined,
    customerNumber: typeof b.customer?.number === 'string' ? b.customer.number : undefined,
    metadata: asRecord(b.assistantOverrides?.metadata),
    variables: asRecord(b.assistantOverrides?.variableValues),
  };
}

async function teardown(): Promise<{ residual: Array<{ table: string; rows: number }> }> {
  for (const token of issuedTokens) piiVault.expireToken(token, 'sim-harness-teardown');
  const attempts = await plain.callAttempt.findMany({
    where: { claim: { practiceId } },
    select: { id: true, vapiCallId: true },
  });
  const claims = await plain.insuranceClaim.findMany({ where: { practiceId }, select: { id: true } });
  const markers = [
    practiceId,
    ...claims.map((c) => c.id),
    ...attempts.map((a) => a.id),
    ...attempts.map((a) => a.vapiCallId).filter((v): v is string => typeof v === 'string' && v.length > 0),
    ...createdAttemptIds,
  ];
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
        // A foreign key still points at this row; a later pass removes it
        // once the referencing row is gone.
      }
    }
    if (deleted === 0) break;
  }
  await plain.$executeRaw`DELETE FROM queue_engine_lease`;
  const residual = await tablesWithText([...markers, ...phiValues()]);
  return { residual };
}

describe.skipIf(!dbReady)('simulation harness Stage 1: full product pipeline against a fake carrier', () => {
  const dispatched: Array<{ scenario: ScenarioId; claimId: string; vapiCallId: string; carrierId: string; attemptId: string }> = [];

  beforeAll(async () => {
    await acquireSimLock();
    interceptor.install();
    log.note('Stage 1 is offline: no audio, no Vapi, no carrier. Pickup timing, hold detection and scribe-after-transfer cannot be measured here (gaps 2 and 11).');
    log.note('Section 5 thresholds, Stage A and Option B are UNVERIFIED until the PRD is supplied (decision D9).');
    await teardown();

    const csvDigits = bundle.csv.clean.replace(/\D/gu, ' ');
    const realNumberInData = [...realCarrierDigits].filter((d) => csvDigits.includes(d));
    log.expect('Setup', '21', 'No real carrier number in synthetic data', realNumberInData.length === 0,
      `scanned clean CSV for ${realCarrierDigits.size} allowlisted carrier numbers; hits=${realNumberInData.length}`);
    log.expect('Setup', '21', 'Practice is marked synthetic', bundle.practice.name.startsWith('SYNTHETIC ONLY'), bundle.practice.name);

    const buckets = { '0-29': 0, '30-59': 0, '60-89': 0, '90-119': 0, '120+': 0 };
    for (const r of records) {
      const d = Number(r.claim.days_outstanding);
      const key = d < 30 ? '0-29' : d < 60 ? '30-59' : d < 90 ? '60-89' : d < 120 ? '90-119' : '120+';
      buckets[key] += Number(r.claim.amount_outstanding);
    }
    log.record('Setup', '1', 'Synthetic aging report built', 'PASS', JSON.stringify(buckets));
    log.note('Factory limits days_outstanding to 32 to 88, so the 0-29, 90-119 and 120+ buckets are empty. The under-30 and over-90 gates are therefore not exercised in this run.');

    await plain.practice.create({
      data: {
        id: practiceId,
        name: bundle.practice.name,
        timezone: bundle.practice.timezone,
        passwordHash: 'synthetic-test-password-hash',
        billingPhone: bundle.practice.billingPhone,
        faxNumber: bundle.practice.faxNumber,
        practiceAddress: bundle.practice.practiceAddress,
        npi: bundle.practice.registrationNumber,
        settings: JSON.parse(JSON.stringify({
          ...defaultPracticeSettings(),
          escalationPhoneNumber: ESCALATION_PHONE,
          humanAssistedMode: true,
          voiceAgentEnabled: true,
          billingPhone: bundle.practice.billingPhone,
          carrierConfigs: defaultPracticeSettings().carrierConfigs.map((c) => ({
            ...c,
            authorizationSubmitted: true,
            authorizationSubmittedAt: new Date().toISOString(),
            providerNumber: 'SYN-PROV-0001',
          })),
        })) as object,
      },
    });
    const frontDesk = bundle.identities.find((i) => i.role === 'front_desk');
    if (frontDesk) {
      await plain.user.create({
        data: {
          id: frontDesk.id,
          practiceId,
          email: frontDesk.email,
          passwordHash: 'synthetic-test-password-hash',
          role: 'front_desk',
          displayName: 'Synthetic front_desk',
        },
      });
    }
    log.note('Dispatch gates observed before any dial: voiceAgentEnabled (default false, VOICE_AGENT_DISABLED) and, per carrier, a Billing Agent Authorization Letter flag plus a provider number (CARRIER_NOT_AUTHORIZED). The synthetic practice sets all three in settings, as onboarding would.');
    log.record('Setup', '6', 'Gap 7 addendum: practice settings carry minimumClaimAgeDays (21 TELUS, 32 others)', 'FINDING', 'defaultCarrierConfigs() in practiceSettingsService.ts sets minimumClaimAgeDays, but validateDispatch (src/carriers/adapter.ts) never reads it; the flat 30-day floor is what gates. That is a fifth age number.');
    piiVault.useStore(plain);
  }, 120_000);

  afterAll(async () => {
    const { residual } = await teardown().catch(() => ({ residual: [{ table: 'teardown-error', rows: -1 }] }));
    log.expect('Teardown', 'all', 'Teardown left no synthetic data behind', residual.length === 0,
      residual.length === 0 ? 'full-database scan for practice, claim, attempt markers and synthetic PHI: 0 rows' : JSON.stringify(residual));
    log.note(`Spend: $0. Outbound requests intercepted: ${interceptor.requests.length} (Vapi stub ${interceptor.requests.filter((r) => r.disposition === 'vapi_stub').length}, Anthropic stub ${interceptor.requests.filter((r) => r.disposition === 'anthropic_stub').length}, recording-delete stub ${interceptor.requests.filter((r) => r.disposition === 'recording_delete_stub').length}, blocked ${interceptor.blocked().length}). Non-local node http(s) attempts blocked: ${interceptor.blockedNodeRequests.length}.`);
    log.note('Teardown does not remove the payload-free webhook delivery ledger rows (body hashes only) or the global queue lease row; neither holds synthetic identifiers.');
    const reportPath = log.writeReport();
    console.warn(`[sim-harness] run ${RUN_ID} verdict ${log.verdict()} report ${reportPath}`);
    interceptor.uninstall();
    await plain.$disconnect().catch(() => undefined);
    releaseSimLock();
    for (const [k, v] of savedEnv) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }, 120_000);

  it('Step 1: import through the real PMS pipeline tokenizes PHI and ages claims', async () => {
    const result = await runPmsImportPipeline(plain, { practiceId, pmsSource: 'other', rows: parseSimpleCsv(bundle.csv.clean) });
    log.expect('1 Import', '1', 'Import pipeline succeeded', result.status === 'success', `status=${result.status} imported=${result.imported} failed=${result.failed}`);
    const claims = await plain.insuranceClaim.findMany({ where: { practiceId } });
    issuedTokens.push(...claims.map((c) => c.patientToken));
    log.expect('1 Import', '1', 'All synthetic claims created', claims.length === records.length, `${claims.length} of ${records.length}`);

    const now = new Date();
    const ageMismatch: string[] = [];
    const computedVsSupplied: string[] = [];
    for (const r of records) {
      const c = claims.find((x) => x.claimNumber === r.claim.claim_number);
      if (!c) continue;
      if (c.daysOutstanding !== Number(r.claim.days_outstanding)) ageMismatch.push(`${c.claimNumber}:${c.daysOutstanding}!=${r.claim.days_outstanding}`);
      const computed = deriveDaysOutstanding({ daysOutstanding: 0, submittedAt: new Date(r.claim.submitted_date), servicedAt: new Date(r.claim.treatment_date) }, now);
      computedVsSupplied.push(`${r.claim.days_outstanding}->${computed}`);
    }
    log.expect('1 Import', '1', 'days_outstanding persisted as supplied by the PMS row', ageMismatch.length === 0, ageMismatch.join(', ') || 'all match');
    log.record('1 Import', '1', 'Submission-date age computed by claimAge.ts vs supplied value', 'FINDING',
      `supplied->submission-date age today: ${computedVsSupplied.join(', ')}. By design an export that states an age wins (claimAge.ts). The factory anchors dates at 2026-06-30, so without the days_outstanding column every claim would be over 90 days and escalate instead of dial. Whether a stored stated age is re-aged on later syncs is UNVERIFIED.`);

    const carrierMap = records.map((r) => `${r.claim.insurance_carrier}=>${claims.find((c) => c.claimNumber === r.claim.claim_number)?.carrierId ?? 'MISSING'}`);
    log.expect('1 Import', '1', 'Every carrier name mapped to a carrier id', !carrierMap.some((m) => m.endsWith('MISSING') || m.endsWith('other')), carrierMap.join(', '));

    await new Promise((resolve) => setTimeout(resolve, 300));
    const hits = await tablesWithText(phiValues());
    log.expect('1 Import', '2', 'Zero plaintext synthetic PHI anywhere in the database after import', hits.length === 0, hits.length === 0 ? `scanned all public tables for ${phiValues().length} values` : JSON.stringify(hits));

    const first = claims[0];
    if (first) {
      const main = piiVault.detokenize(first.patientToken, 'sim-harness', { practiceId });
      let legacy = 'not attempted';
      try {
        legacy = legacyVault.detokenize(first.patientToken) ? 'resolved' : 'empty';
      } catch (e) {
        legacy = `throws: ${(e as Error).message.slice(0, 80)}`;
      }
      log.record('1 Import', '2', 'Gap 9: which vault holds the import tokens', 'FINDING',
        `src/pii-vault.ts piiVault.detokenize success=${main.success}; src/services/pii-vault.ts detokenize ${legacy}`);
    }
    expect(interceptor.blocked()).toHaveLength(0);
  }, 120_000);

  it('Step 2: priority order and cheapest-channel triage close a paid claim without a call', async () => {
    const queue = await plain.callQueue.findMany({
      where: { practiceId, status: 'PENDING' },
      orderBy: [{ priority: 'desc' }, { scheduledFor: 'asc' }],
      include: { claim: { select: { id: true, claimNumber: true, daysOutstanding: true, carrierId: true } } },
    });
    log.record('2 Prioritize', '4', 'Queue order as stored (priority, then scheduledFor)', 'FINDING',
      queue.map((q) => `${q.claim.claimNumber}[${q.priority},age ${q.claim.daysOutstanding},ageScore ${computeAgeScore(q.claim.daysOutstanding)}]`).join(' > '));

    const dialable = queue.filter((q) => q.claim.carrierId !== 'telus_adjudicare');
    const paidInPms = dialable[0];
    if (!paidInPms) {
      log.record('2 Triage', '5', 'Triage closes a PMS-paid claim', 'UNVERIFIED', 'no dialable queued claim available');
      return;
    }
    await plain.insuranceClaim.update({ where: { id: paidInPms.claim.id }, data: { outstandingAmount: 0 } });
    const before = interceptor.dials().length;
    await runDeskQueueTick(prisma);
    const newDials = interceptor.dials().slice(before);
    const dialedTriaged = newDials.some((d) => dialBody(d).metadata?.claimId === paidInPms.claim.id);
    const triagedAfter = await plain.insuranceClaim.findUnique({ where: { id: paidInPms.claim.id }, select: { status: true } });
    const triageEvent = await plain.claimRecoveryEvent.findFirst({ where: { claimId: paidInPms.claim.id, eventType: 'TRIAGE_RESOLVED' } });
    log.expect('2 Triage', '5', 'PMS-paid claim closed by triage without a dial', !dialedTriaged && Boolean(triageEvent),
      `claim ${paidInPms.claim.claimNumber} status=${triagedAfter?.status} TRIAGE_RESOLVED event=${Boolean(triageEvent)} dialed=${dialedTriaged}`);
    log.expect('2 Triage', '5,6', 'Remaining claims still proceed to dispatch', newDials.length === 1, `dials this tick=${newDials.length}`);
    log.record('2 Triage', '5', 'CDAnet channel', 'FINDING', 'enrolledCdanetClaimStatusAdapter is an explicit no-signal contract adapter; it never resolves a claim (claimStatusProbe.ts header).');
  }, 120_000);

  it('Step 3: dispatch picks the Hold Sentinel squad, keeps PHI out of metadata, and dials only through the interceptor', async () => {
    const dial = interceptor.dials()[0];
    if (!dial) {
      log.record('3 Dispatch', '6,8', 'A dial was produced', 'FAIL', 'no dial recorded');
      return;
    }
    const body = dialBody(dial);
    const claimId = typeof body.metadata?.claimId === 'string' ? body.metadata.claimId : '';
    log.expect('3 Dispatch', '6,9', 'Hold Sentinel squad selected', body.squadId === process.env.VAPI_HUMAN_ASSISTED_SQUAD_ID, `squadId=${body.squadId}`);
    const metaLeaks = leaks(JSON.stringify(body.metadata ?? {}));
    log.expect('3 Dispatch', '8', 'Vapi metadata carries no PHI', metaLeaks.length === 0, `metadata keys=${Object.keys(body.metadata ?? {}).join(',')}; leaks=${metaLeaks.length}`);
    const varLeaks = leaks(JSON.stringify(body.variables ?? {}));
    log.record('3 Dispatch', '8', 'PHI present only in ephemeral variableValues', varLeaks.length > 0 ? 'PASS' : 'FINDING', `variableValues PHI values present=${varLeaks.length}`);
    const digits = (body.customerNumber ?? '').replace(/\D/gu, '');
    log.record('3 Dispatch', '8', 'Dial destination', realCarrierDigits.has(digits) ? 'FINDING' : 'PASS',
      realCarrierDigits.has(digits)
        ? `payload targets a REAL allowlisted carrier line (${body.customerNumber}); the hardcoded allowlist cannot point at a mock, so in Stage 1 interception is the only barrier. Recorded, never sent.`
        : `destination ${body.customerNumber}`);
    const attempt = await plain.callAttempt.findFirst({ where: { claimId }, orderBy: { initiatedAt: 'desc' } });
    log.expect('3 Dispatch', '6', 'Idempotency key present on the dial', dial.idempotencyKey === `${claimId}:1`, `Idempotency-Key header=${dial.idempotencyKey ?? 'absent'} expected ${claimId}:1`);
    log.expect('3 Dispatch', '7', 'Call attempt starts in the live dialing state', attempt?.liveState === 'dialing' && attempt.isHumanAssisted, `liveState=${attempt?.liveState} activeAgent=${attempt?.activeAgent} isHumanAssisted=${attempt?.isHumanAssisted}`);
    log.record('3 Dispatch', '7', 'AR engine state machine (Claim_Queued ...) in the live path', 'FINDING',
      'src/services/arEngine/stateMachine.ts and reconciler.ts are imported by nothing outside src/services/arEngine/. The live path tracks CallAttempt.liveState instead. Brief Step 3/4 state-machine assertions test unwired code.');
    log.record('3 Dispatch', '6', 'No dial with zero ready staff', 'FAIL',
      'The practice has no staff presence or availability state, and the dial still went out. runDeskQueueTick has no staff-capacity gate (no availability check in src/server/frontDesk/queueEngine.ts); missed handoffs are handled after pickup by the staff_unavailable script.');
    if (attempt) createdAttemptIds.push(attempt.id);
  }, 60_000);

  it('Steps 4 to 7: fake carrier calls run through the real webhook, scribe, outcome and metering', async () => {
    for (const scenario of SCENARIO_ORDER) {
      if (dispatched.length > 0) {
        const before = interceptor.dials().length;
        await runDeskQueueTick(prisma);
        if (interceptor.dials().length === before) {
          const gate = await canMakeCall(practiceId);
          const practiceRow = await plain.practice.findUnique({ where: { id: practiceId }, select: { billingTier: true } });
          if (!gate.allowed && practiceRow?.billingTier === 'trial') {
            const used = await plain.callAttempt.aggregate({ where: { claim: { practiceId } }, _sum: { minutesBilled: true } });
            log.record('9 Proof', '18', 'Trial daily cap stops dispatch', 'FINDING',
              `plan gate reason=${gate.reason ?? 'unknown'} after ${used._sum.minutesBilled ?? 0} billed minutes. The cap is checked before each dial, not projected, so realistic 15 to 35 minute holds overshoot it; a trial practice gets about two carrier calls a day. Practice moved to the sentinel tier (active) so the remaining scenarios can run.`);
            await plain.practice.update({ where: { id: practiceId }, data: { billingTier: 'sentinel', subscriptionStatus: 'active' } });
            await runDeskQueueTick(prisma);
          }
        }
        if (interceptor.dials().length === before) {
          const gateAfter = await canMakeCall(practiceId);
          log.record('4-7', '6,18', 'Queue tick produced no dial', 'FINDING', `plan gate allowed=${gateAfter.allowed} reason=${gateAfter.reason ?? 'none'}`);
          log.scenario({ scenario, persona: REP_SCRIPTS[scenario].persona, carrierId: '-', expected: EXPECTED_CLAIM_STATUS[scenario], observed: 'no dial produced by the queue tick', status: 'UNVERIFIED' });
          continue;
        }
      }
      const dial = interceptor.dials()[interceptor.dials().length - 1];
      if (!dial) continue;
      const vapiCallId = `sim-call-${String(interceptor.dials().length).padStart(3, '0')}`;
      const body = dialBody(dial);
      const claimId = typeof body.metadata?.claimId === 'string' ? body.metadata.claimId : '';
      const claim = await plain.insuranceClaim.findUnique({ where: { id: claimId } });
      const attempt = await plain.callAttempt.findUnique({ where: { vapiCallId } });
      if (!claim || !attempt) {
        log.scenario({ scenario, persona: REP_SCRIPTS[scenario].persona, carrierId: '-', expected: EXPECTED_CLAIM_STATUS[scenario], observed: `missing claim or attempt for ${vapiCallId}`, status: 'FAIL' });
        continue;
      }
      createdAttemptIds.push(attempt.id);
      dispatched.push({ scenario, claimId, vapiCallId, carrierId: claim.carrierId, attemptId: attempt.id });
      const step = `4-7 ${scenario}`;
      const fake = buildFakeCall({
        carriersDir: CARRIERS_DIR,
        carrierId: claim.carrierId,
        scenario,
        vapiCallId,
        metadata: body.metadata ?? {},
        phi: phiForClaimNumber(claim.claimNumber),
        startedAt: attempt.initiatedAt,
      });
      log.record(step, '10', 'Fake carrier timeline from carrier config JSON', 'PASS',
        `${fake.timeline.filter((e) => e.phase === 'ivr').length} IVR steps, hold ${fake.holdSeconds}s, total ${fake.totalSeconds}s`);

      const r1 = await postWebhook(fake.envelopes.inProgress);
      log.expect(step, '12', 'status-update accepted', r1.status === 200, `HTTP ${r1.status}`);

      if (fake.envelopes.liveTranscript) {
        const rt = await postWebhook(fake.envelopes.liveTranscript);
        const blockAfterLive = await plain.carrierBlockEvent.findFirst({ where: { practiceId, carrierId: claim.carrierId, resumedAt: null } });
        log.expect(step, '12,21', 'Live refusal phrase triggers CARRIER_BLOCK', Boolean(blockAfterLive),
          `HTTP ${rt.status} body=${JSON.stringify(rt.body)}; block=${Boolean(blockAfterLive)}. Native Vapi "transcript" messages are dropped by normalizeVapiWebhook (src/webhooks/vapiNormalizer.ts returns null for unhandled types), so the live phrase detector in vapiDeskEvents.ts never sees them.`);
      }

      const transfersBefore = interceptor.transfers().length;
      const r2 = await postWebhook(fake.envelopes.staffHandoff);
      const handoff = toolResults(r2.body)[0];
      const newTransfers = interceptor.transfers().slice(transfersBefore);
      const transfer = newTransfers[0];
      const transferBody = typeof transfer?.body === 'object' && transfer.body !== null ? JSON.stringify(transfer.body) : '';
      log.expect(step, '9,17', 'Pickup handoff transfers this call to the escalation line',
        Boolean(transfer) && transfer?.path === `/${vapiCallId}/control` && transferBody.includes(ESCALATION_PHONE),
        `result="${handoff?.result ?? ''}" transfer=${transfer?.path ?? 'none'}`);
      const notice = await plain.practiceNotification.findFirst({ where: { practiceId, claimId, type: 'LIVE_CALL_NEEDS_STAFF' } });
      log.expect(step, '17', 'Staff alerted on pickup', Boolean(notice), notice ? `notification "${notice.subject}"` : 'no LIVE_CALL_NEEDS_STAFF notification');

      const r3 = await postWebhook(fake.envelopes.logOutcome);
      const humanLog = await plain.humanAssistedCallLog.findUnique({ where: { vapiCallId } });
      log.expect(step, '14', 'Claims_Scribe outcome logged', Boolean(humanLog) && humanLog?.scenario === REP_SCRIPTS[scenario].scribeScenario,
        `HTTP ${r3.status} scenario=${humanLog?.scenario ?? 'none'}`);

      const r4 = await postWebhook(fake.envelopes.endOfCall);
      log.expect(step, '12', 'End-of-call report accepted', r4.status === 200, `HTTP ${r4.status} body=${JSON.stringify(r4.body)}`);

      const after = await plain.callAttempt.findUnique({ where: { vapiCallId } });
      const claimAfter = await plain.insuranceClaim.findUnique({ where: { id: claimId } });
      log.record(step, '7,11', 'Live state sequence Dialing > IVR > Hold > Agent', 'FAIL',
        `observed final liveState=${after?.liveState ?? 'null'} activeAgent=${after?.activeAgent ?? 'null'}. No IVR or hold transition reaches the attempt: status-update carries no agent, and normalizeVapiWebhook drops analysis.collectrx, so processAgentTransition never runs on native payloads.`);
      log.record(step, '7,11', 'Hold seconds recorded', 'FAIL',
        `scripted hold ${fake.holdSeconds}s; CallAttempt has no hold-seconds column and nothing persists hold time (prisma/schema.prisma CallAttempt model).`);
      log.record(step, '9', 'No AI speech to the rep', 'UNVERIFIED', 'depends on the live Hold_Sentinel and Claims_Scribe prompts on the Vapi dashboard; not observable offline.');

      const transcriptLeaks = leaks(after?.transcriptText);
      log.expect(step, '13', 'Stored transcript contains zero synthetic PHI', Boolean(after?.transcriptText) && transcriptLeaks.length === 0,
        after?.transcriptText ? `leaked values=${transcriptLeaks.length}${transcriptLeaks.length ? ' (patient name survived redaction)' : ''}` : 'no transcript persisted');
      const lineLeaks = await plain.callTranscriptLine.findMany({ where: { vapiCallId } });
      log.expect(step, '13', 'Live transcript lines contain zero synthetic PHI', lineLeaks.every((l) => leaks(l.text).length === 0), `${lineLeaks.length} lines`);
      const deletions = interceptor.requests.filter((r) => r.disposition === 'recording_delete_stub' && r.path.includes(vapiCallId));
      log.expect(step, '2,21', 'Recording deletion requested from Vapi', deletions.length > 0, `${deletions.length} delete request(s); Twilio deletion skipped because TWILIO_ACCOUNT_SID is unset in Stage 1`);

      const durationMin = Math.max(1, Math.ceil(fake.totalSeconds / 60));
      log.expect(step, '18', 'Minutes billed equal ceil(call seconds / 60)', after?.minutesBilled === durationMin,
        `billed=${after?.minutesBilled ?? 'null'} expected=${durationMin} (call ${fake.totalSeconds}s)`);

      const expected = EXPECTED_CLAIM_STATUS[scenario];
      if (scenario === 'ROBOT_REFUSER') {
        const block = await plain.carrierBlockEvent.findFirst({ where: { practiceId, carrierId: claim.carrierId, resumedAt: null } });
        log.scenario({ scenario, persona: REP_SCRIPTS[scenario].persona, carrierId: claim.carrierId, expected: 'CARRIER_BLOCK applied to carrier',
          observed: `block=${Boolean(block)} attempt outcome=${after?.outcome ?? 'null'} carrierBlockDetected=${after?.carrierBlockDetected ?? false}.`,
          status: block ? 'PASS' : 'FAIL' });
      } else {
        const notTerminal = scenario === 'NOT_ON_FILE_RESUBMIT' ? claimAfter?.status !== 'DENIED' && claimAfter?.status !== 'RESOLVED' : true;
        const ok = claimAfter?.status === expected && notTerminal;
        const partialNote = scenario === 'S014_PARTIAL_PAYER' ? ` Scribe scenario=${humanLog?.scenario}; attempt outcome is ${after?.outcome} (CallOutcome has no partial value).` : '';
        if (scenario === 'NOT_ON_FILE_RESUBMIT' && claimAfter?.status === 'IN_QUEUE') {
          log.record(step, '14', 'Resubmit outcome routing', 'FINDING',
            'CLAIM_NOT_RECEIVED maps to claimStatus ESCALATED in humanAssistedOutcomeResolver.ts (comment: a human, not the retry cadence), but the recovery router sent it back to CALL_CARRIER / IN_QUEUE with a recall. The practice is never told to resubmit, and the next call will hear the same answer.');
        }
        log.scenario({ scenario, persona: REP_SCRIPTS[scenario].persona, carrierId: claim.carrierId, expected: `claim ${expected}`,
          observed: `claim ${claimAfter?.status ?? 'missing'}; attempt outcome ${after?.outcome ?? 'null'}.${partialNote}`, status: ok ? 'PASS' : 'FAIL' });
      }
      const tokenAlive = piiVault.detokenize(claim.patientToken, 'sim-harness', { practiceId }).success;
      log.record(step, '2', 'PHI token state after the call', 'FINDING', `token ${tokenAlive ? 'still valid' : 'revoked'} after ${claimAfter?.status ?? '?'}`);
    }
    expect(interceptor.blocked()).toHaveLength(0);
  }, 180_000);

  it('Gap 3: Live Console takeover acts on the call staff selected', async () => {
    const free = await plain.insuranceClaim.findMany({ where: { practiceId, status: { notIn: ['RESOLVED', 'DENIED'] } }, take: 2 });
    const frontDesk = bundle.identities.find((i) => i.role === 'front_desk');
    if (free.length < 2 || !frontDesk) {
      log.record('Gap 3', '17', 'Takeover targets the selected call', 'UNVERIFIED', 'fewer than two claims available to simulate concurrent calls');
      return;
    }
    const first = free[0];
    const second = free[1];
    if (!first || !second) return;
    const a = await plain.callAttempt.create({ data: { claimId: first.id, vapiCallId: 'sim-concurrent-a', initiatedAt: new Date(), liveState: 'on_hold' } });
    const b = await plain.callAttempt.create({ data: { claimId: second.id, vapiCallId: 'sim-concurrent-b', initiatedAt: new Date(Date.now() + 1000), liveState: 'on_hold' } });
    createdAttemptIds.push(a.id, b.id);
    const token = signUserToken({ userId: frontDesk.id, practiceId, role: 'front_desk' });
    // Select the same call twice. A takeover updates the row it transferred,
    // which can change the order Postgres returns rows in, so alternating picks
    // (A then B) can pass by luck. With two picks of B, a route that ignores the
    // selection transfers A at least once whatever the row order.
    const takeover = async (selected: { id: string; vapiCallId: string }): Promise<{ status: number; path: string }> => {
      const before = interceptor.transfers().length;
      const res = await request(deskApp)
        .post(`/api/desk/${practiceId}/active/takeover`)
        .set('Authorization', `Bearer ${token}`)
        .send({ phoneNumber: ESCALATION_PHONE, staffId: frontDesk.id, callAttemptId: selected.id, vapiCallId: selected.vapiCallId });
      return { status: res.status, path: interceptor.transfers().slice(before)[0]?.path ?? 'none' };
    };
    const pickOne = await takeover({ id: b.id, vapiCallId: 'sim-concurrent-b' });
    const pickTwo = await takeover({ id: b.id, vapiCallId: 'sim-concurrent-b' });
    if (pickOne.status !== 200 || pickTwo.status !== 200) {
      log.record('Gap 3', '17', 'Takeover targets the selected call', 'UNVERIFIED', `route returned HTTP ${pickOne.status} and ${pickTwo.status}`);
    } else {
      const target = '/sim-concurrent-b/control';
      log.expect('Gap 3', '17', 'Takeover targets the selected call (B selected twice)', pickOne.path === target && pickTwo.path === target,
        `selected B -> ${pickOne.path}; selected B again -> ${pickTwo.path}. frontDeskApi.ts:341 reads only phoneNumber and staffId, and :345 uses findFirst with no orderBy; pause (:277) and end-call (:318) share the pattern.`);
    }
    await plain.callAttempt.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { completedAt: new Date() } });
    log.record('Gap 4', '8', 'Transfer method in use', 'FINDING', 'transferVapiCall reads call.monitor.controlUrl from GET /call/{id} and posts the documented transfer command to it (docs.vapi.ai/calls/call-features); the interceptor stands in for the control host.');
  }, 60_000);

  it('Step 8: lessons from staff-handled calls stay PHI-free and only APPROVED navigation lessons inject', async () => {
    const anthropicDuringWebhook = interceptor.requests.filter((r) => r.disposition === 'anthropic_stub').length;
    log.record('8 Learning', '16', 'Gap 1: webhook skips lesson extraction for staff-handled calls', anthropicDuringWebhook === 0 ? 'FINDING' : 'FAIL',
      `Anthropic requests during webhook processing=${anthropicDuringWebhook}; gate at src/webhooks/vapi.ts:623 (!callAttempt.isHumanAssisted). Extraction below is invoked directly (decision D2).`);
    const paid = dispatched.find((d) => d.scenario === 'C1_PAID_IN_FULL');
    const routine = dispatched.find((d) => d.scenario === 'DENIED_WITH_CODE');
    if (!paid) {
      log.record('8 Learning', '16', 'Lesson extraction on a staff-handled call', 'UNVERIFIED', 'C1 call not dispatched');
      return;
    }
    const claim = await plain.insuranceClaim.findUnique({ where: { id: paid.claimId } });
    const leakedName = claim ? phiForClaimNumber(claim.claimNumber).patientName : 'unknown';
    interceptor.queueLessonResponse({
      lessons: [
        { category: 'IVR_NAVIGATION', observation: 'The claims menu accepts zero to reach a representative directly.', recommendation: 'Press 0 at the claims menu to reach a representative sooner.', confidence: 0.8 },
        { category: 'REP_INTERACTION', observation: `Rep asked for ${leakedName} before the provider number.`, recommendation: 'Offer the patient name first.', confidence: 0.6 },
        { category: 'EXTRACTION', observation: 'Rep read the date of birth 1915-03-02 back.', recommendation: 'Confirm dates.', confidence: 0.5 },
      ],
    });
    const before = interceptor.requests.length;
    const stored = await extractLessonsFromCall(plain, paid.attemptId);
    const sent = interceptor.requests.slice(before).find((r) => r.disposition === 'anthropic_stub');
    const sentLeaks = leaks(JSON.stringify(sent?.body ?? ''));
    log.expect('8 Learning', '16,21', 'Transcript sent to the extraction model contains zero synthetic PHI', Boolean(sent) && sentLeaks.length === 0,
      sent ? `leaked values in outbound LLM request=${sentLeaks.length}` : 'no extraction request (transcript under 200 chars or missing)');
    const lessons = await plain.carrierLesson.findMany({ where: { sourceCallAttemptId: paid.attemptId } });
    log.expect('8 Learning', '16', 'Lessons land PROPOSED', lessons.length > 0 && lessons.every((l) => l.status === 'PROPOSED'), `stored=${stored} statuses=${lessons.map((l) => l.status).join(',')}`);
    const dobLesson = lessons.some((l) => l.observation.includes('1915-03-02'));
    log.expect('8 Learning', '16', 'Identifier filter drops a lesson containing a date', !dobLesson, `date lesson stored=${dobLesson}`);
    const nameLesson = lessons.some((l) => leaks(l.observation).length > 0);
    log.expect('8 Learning', '16', 'Identifier filter drops a lesson containing a patient name', !nameLesson,
      `name lesson stored=${nameLesson}. containsIdentifierLikeContent (carrierLessons.ts) only matches 6+ digit runs and ISO dates; names reach PROPOSED and only human review stops them.`);
    const nav = lessons.find((l) => l.category === 'IVR_NAVIGATION');
    if (nav) {
      const notesBefore = await getApprovedNavigationNotes(plain, paid.carrierId as CarrierId);
      await reviewLesson(plain, nav.id, 'approve', 'sim-harness-reviewer');
      const notesAfter = await getApprovedNavigationNotes(plain, paid.carrierId as CarrierId);
      log.expect('8 Learning', '16', 'Only APPROVED navigation lessons inject into IVR instructions', !notesBefore.includes(nav.recommendation) && notesAfter.includes(nav.recommendation),
        `before approval injected=${notesBefore.includes(nav.recommendation)}; after=${notesAfter.includes(nav.recommendation)}`);
    }
    if (routine) {
      interceptor.queueLessonResponse({ lessons: [] });
      const zero = await extractLessonsFromCall(plain, routine.attemptId);
      log.expect('8 Learning', '16', 'Zero lessons is accepted for a routine call', zero === 0, `stored=${zero}`);
    }
  }, 60_000);

  it('Step 9 and CARRIER_BLOCK: dashboard arithmetic, metering, and a blocked carrier is never dialled', async () => {
    const completed = await plain.callAttempt.findMany({ where: { claim: { practiceId }, outcome: { not: null } } });
    const timeSaved = await getTimeSaved(plain, practiceId, { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) });
    const scriptedHoldMinutes = dispatched.reduce((sum, d) => sum + REP_SCRIPTS[d.scenario].holdSeconds, 0) / 60;
    log.expect('9 Proof', '19', 'Staff minutes saved matches the run-log hold arithmetic', Math.abs(timeSaved.timeSavedMinutes - scriptedHoldMinutes) < 1,
      `dashboard=${timeSaved.timeSavedMinutes} min (${timeSaved.completedCalls} calls x ${timeSaved.avgManualCallMinutes} fixed); run log hold=${scriptedHoldMinutes.toFixed(1)} min. getTimeSaved (insurance-analytics.ts) uses a constant, not measured hold time.`);
    log.record('9 Proof', '19', 'Hold minutes avoided metric', 'FAIL', 'No hold-minutes-avoided metric exists in server code; nothing to compare against the run log.');
    const usage = await plain.usagePeriod.findFirst({ where: { practiceId }, orderBy: { createdAt: 'desc' } });
    const billedSum = completed.reduce((sum, a) => sum + (a.minutesBilled ?? 0), 0);
    log.expect('9 Proof', '18', 'Calls counted against the tier allowance', Boolean(usage) && usage?.minutesConsumed === billedSum && usage.callsCompleted === completed.filter((a) => a.minutesBilled !== null).length,
      `usagePeriod minutesConsumed=${usage?.minutesConsumed ?? 'none'} callsCompleted=${usage?.callsCompleted ?? 'none'}; sum of attempt minutesBilled=${billedSum}`);

    const pending = await plain.callQueue.findFirst({
      where: { practiceId, status: 'PENDING', claim: { carrierId: { notIn: ['telus_adjudicare', 'other'] } } },
      include: { claim: true },
      orderBy: [{ priority: 'desc' }, { scheduledFor: 'asc' }],
    });
    if (!pending) {
      log.record('3 Dispatch', '6,21', 'CARRIER_BLOCK respected at dispatch', 'UNVERIFIED', 'no pending dialable claim left');
      return;
    }
    const blockedCarrier = pending.claim.carrierId;
    const { heldQueueCount } = await applyCarrierBlock(plain, { practiceId, carrierId: blockedCarrier, vapiCallId: 'sim-block-test', reason: 'sim-harness CARRIER_BLOCK check', hangVapi: false });
    const blockedQueue = await plain.callQueue.findUnique({ where: { claimId: pending.claimId }, select: { status: true } });
    const before = interceptor.dials().length;
    await runDeskQueueTick(prisma);
    const newDials = interceptor.dials().slice(before);
    const dialedBlocked = newDials.filter((d) => {
      const id = dialBody(d).metadata?.carrierId;
      return id === blockedCarrier;
    });
    log.expect('3 Dispatch', '6,21', 'CARRIER_BLOCK respected at dispatch (no dial to blocked carrier)', dialedBlocked.length === 0,
      `blocked ${blockedCarrier}; queue entries held by applyCarrierBlock=${heldQueueCount}; top candidate queue status=${blockedQueue?.status ?? 'none'}; dials to it this tick=${dialedBlocked.length}; other dials=${newDials.length - dialedBlocked.length}`);
    for (const d of newDials) {
      const vars = dialBody(d).variables;
      const learned = typeof vars?.carrier_ivr_instructions === 'string' && vars.carrier_ivr_instructions.includes('LEARNED');
      log.record('8 Learning', '16', 'Approved lesson reached a later dial', learned ? 'PASS' : 'FINDING', `carrier=${String(dialBody(d).metadata?.carrierId)} learnedNote=${learned}`);
    }
    expect(interceptor.blocked()).toHaveLength(0);
    expect(interceptor.blockedNodeRequests).toHaveLength(0);
  }, 60_000);
});
