/**
 * Dental office day simulation (offline, no keys, no calls, $0).
 *
 * Stage 1 proves the happy path for five scripted rep personas. This suite
 * plays the other half of a real office day: a messy PMS export, claims at the
 * age boundaries, calls that never connect, retries, a carrier that blocks the
 * practice, two practices sharing one carrier, duplicate webhooks, a re-import
 * after a claim closed, and western practices whose staff are not at work when
 * the Eastern call window opens.
 *
 * Like Stage 1, product checks are recorded in the run log and never throw.
 * Only harness-safety invariants are hard assertions (nothing escaped
 * interception, teardown left nothing behind). The product verdict is in
 * REPORT.md. A FINDING is an observed behaviour a pilot dentist would hit and
 * that the code or docs do not already call a known limit.
 */
import { createHmac, randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { PrismaClient, type CarrierId } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/lib/prisma.js';
import { piiVault } from '../../src/pii-vault.js';
import { parseSimpleCsv } from '../../src/server/csv/parseSimple.js';
import { runPmsImportPipeline } from '../../src/server/pms/pmsImportPipeline.js';
import { runDeskQueueTick } from '../../src/server/frontDesk/queueEngine.js';
import { applyCarrierBlock, clearCarrierBlock } from '../../src/server/frontDesk/carrierBlockService.js';
import vapiWebhookRouter from '../../src/webhooks/vapi.js';
import { createFrontDeskRouter } from '../../src/server/routes/frontDeskApi.js';
import { signUserToken } from '../../src/server/authToken.js';
import { defaultPracticeSettings } from '../../src/server/services/practiceSettingsService.js';
import { OutboundInterceptor, type InterceptedRequest } from './outboundInterceptor.js';
import { RunLog } from './runLog.js';
import { acquireSimLock, releaseSimLock } from './simLock.js';
import {
  AWKWARD_NAMES,
  CARRIER_SPELLINGS,
  officeRow,
  toOfficeCsv,
  type OfficeRow,
} from './officeFixtures.js';

const ESCALATION_PHONE = '+16135550150';
const RUN_ID = `office-day-${new Date().toISOString().replace(/[:.]/gu, '-')}`;

const ENV_KEYS = [
  'PHI_ENCRYPTION_KEY', 'VAPI_API_KEY', 'VAPI_PHONE_NUMBER_ID', 'VAPI_SQUAD_ID',
  'VAPI_HUMAN_ASSISTED_SQUAD_ID', 'COLLECTRX_FORCE_CALL_WINDOW', 'ANTHROPIC_API_KEY',
  'COLLECTRX_ANTHROPIC_EVAL', 'SENDGRID_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
  'AGENTS_ENABLED', 'JWT_SECRET',
] as const;
const savedEnv = new Map<string, string | undefined>(ENV_KEYS.map((k) => [k, process.env[k]]));

process.env.PHI_ENCRYPTION_KEY = '33'.repeat(32);
process.env.VAPI_API_KEY = 'sim-harness-placeholder-not-a-key';
process.env.VAPI_PHONE_NUMBER_ID = 'sim-harness-phone-number-id';
process.env.VAPI_SQUAD_ID = 'sim-autonomous-squad';
process.env.VAPI_HUMAN_ASSISTED_SQUAD_ID = 'sim-hold-sentinel-squad';
process.env.COLLECTRX_FORCE_CALL_WINDOW = '1';
process.env.ANTHROPIC_API_KEY = 'sim-harness-placeholder-not-a-key';
process.env.COLLECTRX_ANTHROPIC_EVAL = '1';
process.env.JWT_SECRET = 'sim-harness-office-day-jwt-placeholder';
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
  console.warn('[sim-office] DATABASE_URL unreachable, office-day run skipped (UNVERIFIED):', (error as Error).message);
}

const log = new RunLog(RUN_ID);
const interceptor = new OutboundInterceptor();
const practiceIds: string[] = [];
const phiValues: string[] = [];
const issuedTokens: string[] = [];
const webhookApp = express();
webhookApp.use('/api/webhooks/vapi', express.raw({ type: 'application/json' }), vapiWebhookRouter);
const deskApp = express();
deskApp.use(express.json());
deskApp.use('/api/desk', createFrontDeskRouter());

interface PracticeOpts {
  label: string;
  timezone?: string;
  voiceAgentEnabled?: boolean;
  authorizeCarriers?: boolean;
}

interface Office {
  id: string;
  staffId: string;
  token: string;
}

async function makeOffice(opts: PracticeOpts): Promise<Office> {
  const id = randomUUID();
  const staffId = randomUUID();
  const authorize = opts.authorizeCarriers ?? true;
  const defaults = defaultPracticeSettings();
  await plain.practice.create({
    data: {
      id,
      name: `SYNTHETIC ONLY ${opts.label}`,
      timezone: opts.timezone ?? 'America/Toronto',
      passwordHash: 'synthetic-test-password-hash',
      billingPhone: '+16135550101',
      faxNumber: '+16135550102',
      practiceAddress: '1 Synthetic Way, Ottawa ON',
      // Digits only: dispatch refuses an NPI a phone menu cannot accept. Synthetic and unique per office.
      npi: `99${id.replace(/\D/gu, '').padEnd(8, '0').slice(0, 8)}`,
      billingTier: 'sentinel',
      subscriptionStatus: 'active',
      settings: JSON.parse(JSON.stringify({
        ...defaults,
        escalationPhoneNumber: ESCALATION_PHONE,
        humanAssistedMode: true,
        voiceAgentEnabled: opts.voiceAgentEnabled ?? true,
        carrierConfigs: defaults.carrierConfigs.map((c) => ({
          ...c,
          authorizationSubmitted: authorize,
          authorizationSubmittedAt: authorize ? new Date().toISOString() : null,
          providerNumber: authorize ? 'SYN-PROV-0001' : '',
        })),
      })) as object,
    },
  });
  await plain.user.create({
    data: {
      id: staffId,
      practiceId: id,
      email: `front-desk-${id.slice(0, 8)}@collectrx-test.local`,
      passwordHash: 'synthetic-test-password-hash',
      role: 'front_desk',
      displayName: 'Synthetic front desk',
    },
  });
  practiceIds.push(id);
  return { id, staffId, token: signUserToken({ userId: staffId, practiceId: id, role: 'front_desk' }) };
}

function trackPhi(rows: OfficeRow[]): void {
  for (const r of rows) {
    for (const v of [`${r.patient_first_name} ${r.patient_last_name}`, r.subscriber_id, r.group_policy_number]) {
      if (v.trim().length >= 6) phiValues.push(v);
    }
  }
}

interface ImportOutcome {
  status: string;
  imported: number;
  failed: number;
  threw: string | null;
}

async function importCsv(practiceId: string, csv: string, rows: OfficeRow[] = []): Promise<ImportOutcome> {
  trackPhi(rows);
  try {
    const result = await runPmsImportPipeline(plain, { practiceId, pmsSource: 'other', rows: parseSimpleCsv(csv) });
    const claims = await plain.insuranceClaim.findMany({ where: { practiceId }, select: { patientToken: true } });
    issuedTokens.push(...claims.map((c) => c.patientToken));
    return { status: result.status, imported: result.imported, failed: result.failed, threw: null };
  } catch (error) {
    return { status: 'threw', imported: 0, failed: 0, threw: (error as Error).message.slice(0, 160) };
  }
}

interface TickResult {
  dials: InterceptedRequest[];
  claimIds: string[];
}

const dialMeta = new Map<string, Record<string, unknown>>();

function claimIdOf(req: InterceptedRequest): string {
  const body = req.body as { assistantOverrides?: { metadata?: { claimId?: unknown } } } | null;
  const id = body?.assistantOverrides?.metadata?.claimId;
  return typeof id === 'string' ? id : '';
}

async function tick(): Promise<TickResult> {
  const before = interceptor.dials().length;
  await runDeskQueueTick(prisma);
  const dials = interceptor.dials().slice(before);
  for (const d of dials) {
    const body = d.body as { assistantOverrides?: { metadata?: unknown } } | null;
    const meta = body?.assistantOverrides?.metadata;
    if (typeof meta === 'object' && meta !== null) dialMeta.set(claimIdOf(d), meta as Record<string, unknown>);
  }
  return { dials, claimIds: dials.map(claimIdOf) };
}

async function freeLines(practiceId: string): Promise<void> {
  await plain.callAttempt.updateMany({ where: { completedAt: null, claim: { practiceId } }, data: { completedAt: new Date() } });
}

/** The tick works every practice in the database, so isolate the one under test. */
async function park(except: string[]): Promise<void> {
  await plain.callQueue.updateMany({
    where: { practiceId: { in: practiceIds.filter((id) => !except.includes(id)) }, status: { in: ['PENDING', 'IN_PROGRESS', 'BLOCKED'] } },
    data: { status: 'COMPLETED' },
  });
}

async function tickFor(practiceId: string): Promise<TickResult> {
  await park([practiceId]);
  return tick();
}

/**
 * Closes a call the way Vapi would: a status update then an end-of-call report
 * carrying the dial's own metadata. If the product leaves the attempt open,
 * the harness frees it so the rest of the day can continue, and reports false.
 */
async function finishCall(claimId: string, reason = 'customer-ended-call', seconds = 600): Promise<boolean> {
  const attempt = await attemptFor(claimId);
  if (!attempt) return false;
  const meta = dialMeta.get(claimId) ?? {};
  await postWebhook({ message: { type: 'status-update', status: 'in-progress', call: { id: attempt.vapiCallId, startedAt: attempt.initiatedAt.toISOString(), assistantOverrides: { metadata: meta } } } });
  await postWebhook(endOfCall(attempt.vapiCallId, attempt.initiatedAt, reason, seconds, meta, reason === 'customer-ended-call' ? 'Rep: thanks\nStaff: thanks' : undefined));
  const row = await plain.callAttempt.findUnique({ where: { id: attempt.id }, select: { completedAt: true } });
  return Boolean(row?.completedAt);
}

/** Runs ticks until a tick makes no dial and returns every claim dialled once. */
async function drain(practiceId: string, max = 40): Promise<string[]> {
  const dialled: string[] = [];
  for (let i = 0; i < max; i += 1) {
    const t = await tickFor(practiceId);
    if (t.dials.length === 0) break;
    for (const id of t.claimIds) {
      if (!dialled.includes(id)) dialled.push(id);
      await finishCall(id);
      await plain.callQueue.updateMany({ where: { claimId: id }, data: { status: 'COMPLETED' } });
    }
    await freeLines(practiceId);
  }
  return dialled;
}

/** Test isolation: the fleet-wide per-carrier limit counts every open attempt in the database. */
async function settleAll(): Promise<void> {
  await plain.callAttempt.updateMany({ where: { completedAt: null }, data: { completedAt: new Date() } });
  await park([]);
}

function postWebhookRaw(raw: string, signature: string): Promise<{ status: number; body: unknown }> {
  return request(webhookApp)
    .post('/api/webhooks/vapi')
    .set('Content-Type', 'application/json')
    .set('x-vapi-signature', signature)
    .send(raw)
    .then((res) => ({ status: res.status, body: res.body as unknown }));
}

function signed(envelope: Record<string, unknown>): { raw: string; signature: string } {
  const raw = JSON.stringify(envelope);
  const secret = process.env.VAPI_WEBHOOK_SECRET ?? '';
  return { raw, signature: `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}` };
}

async function postWebhook(envelope: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const { raw, signature } = signed(envelope);
  return postWebhookRaw(raw, signature);
}

async function attemptFor(claimId: string): Promise<{ id: string; vapiCallId: string; initiatedAt: Date } | null> {
  return plain.callAttempt.findFirst({ where: { claimId }, orderBy: { initiatedAt: 'desc' }, select: { id: true, vapiCallId: true, initiatedAt: true } });
}

function endOfCall(vapiCallId: string, startedAt: Date, endedReason: string, seconds: number, metadata: Record<string, unknown>, transcript?: string): Record<string, unknown> {
  const call = { id: vapiCallId, startedAt: startedAt.toISOString(), assistantOverrides: { metadata } };
  return {
    message: {
      type: 'end-of-call-report',
      startedAt: startedAt.toISOString(),
      endedAt: new Date(startedAt.getTime() + seconds * 1000).toISOString(),
      endedReason,
      call,
      artifact: transcript ? { transcript } : {},
      analysis: { summary: `Simulated ${endedReason}` },
    },
  };
}

async function sweepTables(values: string[]): Promise<Array<{ table: string; rows: number }>> {
  if (values.length === 0) return [];
  const tables = await plain.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
  const patterns = values.map((v) => `%${v.replace(/[%_\\]/gu, (m) => `\\${m}`)}%`);
  const hits: Array<{ table: string; rows: number }> = [];
  for (const { table_name: table } of tables) {
    const rows = await plain.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT count(*)::int AS n FROM "${table.replace(/"/gu, '')}" x WHERE x::text ILIKE ANY($1::text[])`,
      patterns,
    );
    if ((rows[0]?.n ?? 0) > 0) hits.push({ table, rows: rows[0]?.n ?? 0 });
  }
  return hits;
}

async function teardown(): Promise<Array<{ table: string; rows: number }>> {
  for (const token of issuedTokens) piiVault.expireToken(token, 'sim-office-teardown');
  const claims = await plain.insuranceClaim.findMany({ where: { practiceId: { in: practiceIds } }, select: { id: true } });
  const attempts = await plain.callAttempt.findMany({
    where: { claim: { practiceId: { in: practiceIds } } },
    select: { id: true, vapiCallId: true },
  });
  const markers = [...practiceIds, ...claims.map((c) => c.id), ...attempts.map((a) => a.id), ...attempts.map((a) => a.vapiCallId)];
  if (markers.length === 0) return [];
  const tables = await plain.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
  const patterns = markers.map((m) => `%${m}%`);
  for (let pass = 0; pass < 12; pass += 1) {
    let deleted = 0;
    for (const { table_name: table } of tables) {
      try {
        deleted += await plain.$executeRawUnsafe(`DELETE FROM "${table.replace(/"/gu, '')}" x WHERE x::text LIKE ANY($1::text[])`, patterns);
      } catch {
        // A foreign key still points at this row; a later pass removes it.
      }
    }
    if (deleted === 0) break;
  }
  await plain.$executeRaw`DELETE FROM queue_engine_lease`;
  return sweepTables([...markers, ...phiValues]);
}

describe.skipIf(!dbReady)('dental office day: gaps a pilot practice would hit', () => {
  beforeAll(async () => {
    await acquireSimLock();
    interceptor.install();
    log.note('Offline office-day run. No audio, no Vapi, no carrier. Complements Stage 1; known Stage 1 findings are not repeated here.');
  });

  beforeEach(async () => {
    await settleAll();
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.COLLECTRX_FORCE_CALL_WINDOW = '1';
  });

  afterAll(async () => {
    const residual = await teardown().catch(() => [{ table: 'teardown-error', rows: -1 }]);
    log.expect('Teardown', 'all', 'Teardown left no synthetic data behind', residual.length === 0,
      residual.length === 0 ? 'full-database scan: 0 rows' : JSON.stringify(residual));
    log.note(`Spend: $0. Outbound requests intercepted: ${interceptor.requests.length}, blocked ${interceptor.blocked().length}.`);
    const reportPath = log.writeReport();
    console.warn(`[sim-office] run ${RUN_ID} verdict ${log.verdict()} report ${reportPath}`);
    interceptor.uninstall();
    await plain.$disconnect().catch(() => undefined);
    releaseSimLock();
    for (const [k, v] of savedEnv) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }, 120_000);

  it('A. messy PMS export: carrier spellings, awkward names, file formats', async () => {
    const office = await makeOffice({ label: 'A spellings and names' });
    const spellRows = CARRIER_SPELLINGS.map((c, i) => officeRow('SPELL', { carrier: c.spelling, claimNumber: `OFC-SPELL-${String(i).padStart(2, '0')}` }));
    const nameRows = AWKWARD_NAMES.map((n, i) => officeRow('NAME', { first: n.first, last: n.last, claimNumber: `OFC-NAME-${i}` }));
    const out = await importCsv(office.id, toOfficeCsv([...spellRows, ...nameRows], { bom: true, crlf: true }), [...spellRows, ...nameRows]);
    log.record('A Import', 'formats', 'Export with BOM, CRLF line endings, awkward names and 15 carrier spellings imports', out.status === 'success' ? 'PASS' : 'FAIL',
      `status=${out.status} imported=${out.imported} failed=${out.failed} threw=${out.threw ?? 'no'}`);
    const claims = await plain.insuranceClaim.findMany({ where: { practiceId: office.id } });
    const byNumber = new Map(claims.map((c) => [c.claimNumber, c]));
    const wrong: string[] = [];
    CARRIER_SPELLINGS.forEach((c, i) => {
      const got = byNumber.get(`OFC-SPELL-${String(i).padStart(2, '0')}`)?.carrierId ?? 'MISSING';
      if (got !== c.expected) wrong.push(`"${c.spelling}"=>${got} (expected ${c.expected})`);
    });
    log.record('A Import', 'carrier map', 'Every common carrier spelling resolves to the right carrier', wrong.length === 0 ? 'PASS' : 'FAIL',
      wrong.length === 0 ? `${CARRIER_SPELLINGS.length} spellings resolved` : wrong.join('; '));
    const namesStored = AWKWARD_NAMES.map((_n, i) => byNumber.has(`OFC-NAME-${i}`));
    log.record('A Import', 'names', 'Apostrophe, accent, hyphen and comma names import', namesStored.every(Boolean) ? 'PASS' : 'FAIL',
      `stored ${namesStored.filter(Boolean).length} of ${AWKWARD_NAMES.length}`);
    expect(interceptor.blocked()).toHaveLength(0);
  }, 120_000);

  it('A2. one bad row in an otherwise good export: does the office lose the whole file?', async () => {
    const GOOD = 5;
    interface Case {
      label: string;
      bad: OfficeRow[];
      style?: { trailingBlankRows?: number };
      /** The bad row should itself be accepted (it is valid real-world data), not just isolated. */
      badRowShouldImport?: boolean;
    }
    const cases: Case[] = [
      { label: 'blank rows at the end of the file (Excel export)', bad: [], style: { trailingBlankRows: 3 } },
      { label: 'credit or refund row with a negative balance', bad: [officeRow('NEGCASE', { claimNumber: 'OFC-BAD-NEG', outstanding: '-45.00' })] },
      { label: 'zero-balance row', bad: [officeRow('ZEROCASE', { claimNumber: 'OFC-BAD-ZERO', outstanding: '0.00' })] },
      { label: 'currency formatting "$1,180.00" in the balance', bad: [officeRow('MONEY', { claimNumber: 'OFC-BAD-MONEY', outstanding: '$1,180.00' })], badRowShouldImport: true },
      { label: 'carrier not supported (Desjardins)', bad: [officeRow('ODDCAR', { claimNumber: 'OFC-BAD-CARRIER', carrier: 'Desjardins Dental Plan' })] },
      { label: 'blank carrier', bad: [officeRow('NOCAR', { claimNumber: 'OFC-BAD-NOCARRIER', carrier: '' })] },
      { label: 'missing claim number', bad: [officeRow('NOCLM', { claimNumber: '' })] },
      { label: 'PMS footer total row', bad: [{ ...officeRow('FOOT', { claimNumber: 'TOTAL', first: '', last: '' }), patient_dob: '', subscriber_id: '', group_policy_number: '', insurance_carrier: '', procedure_code: '', treatment_codes: '', treatment_date: '', submitted_date: '', amount_billed: '48210.00', amount_outstanding: '19234.50', expected_amount: '', days_outstanding: '' }] },
      { label: 'missing treatment codes', bad: [officeRow('NOCODE', { claimNumber: 'OFC-BAD-NOCODE', treatmentCodes: '' })], badRowShouldImport: true },
      { label: 'day-first date 25/09/2026 in the treatment date', bad: [{ ...officeRow('DMY', { claimNumber: 'OFC-BAD-DMY' }), treatment_date: '25/09/2026' }], badRowShouldImport: true },
    ];
    for (const c of cases) {
      const office = await makeOffice({ label: `A2 ${c.label}` });
      const good = Array.from({ length: GOOD }, (_v, i) => officeRow('GOODROW', { claimNumber: `OFC-GOOD-${i}` }));
      const out = await importCsv(office.id, toOfficeCsv([...good, ...c.bad], c.style), [...good, ...c.bad]);
      const stored = await plain.insuranceClaim.findMany({ where: { practiceId: office.id }, select: { claimNumber: true } });
      const goodStored = stored.filter((x) => x.claimNumber.startsWith('OFC-GOOD-')).length;
      const badStored = c.bad.length > 0 && stored.some((x) => c.bad.some((b) => b.claim_number !== '' && x.claimNumber === b.claim_number));
      const isolated = goodStored === GOOD;
      const detail = `status=${out.status} good rows stored ${goodStored} of ${GOOD}; bad row stored=${badStored}; imported=${out.imported} failed=${out.failed}`;
      if (!isolated) {
        log.record('A2 Isolation', 'import', c.label, 'FINDING', `${detail}. One bad row discards the whole file. A real PMS export almost always carries something like this; the office sees an error and zero claims.`);
      } else if (c.badRowShouldImport && !badStored) {
        log.record('A2 Isolation', 'import', c.label, 'FINDING', `${detail}. Valid real-world data was dropped.`);
      } else {
        log.record('A2 Isolation', 'import', c.label, 'PASS', detail);
      }
    }
  }, 180_000);

  it('B. age boundaries 29, 30, 90, 91, 200: who dials, who escalates, who vanishes', async () => {
    const office = await makeOffice({ label: 'B age gates' });
    const ages = [10, 29, 30, 60, 90, 91, 120, 200];
    const rows = ages.map((d) => officeRow('AGE', { claimNumber: `OFC-AGE-${d}`, days: d }));
    await importCsv(office.id, toOfficeCsv(rows), rows);
    const dialled = await drain(office.id);
    const claims = await plain.insuranceClaim.findMany({ where: { practiceId: office.id }, include: { queueEntry: true } });
    const escalations = await plain.callEscalation.findMany({ where: { practiceId: office.id } });
    const workItems = await plain.workItem.findMany({ where: { practiceId: office.id } });
    for (const d of ages) {
      const claim = claims.find((c) => c.claimNumber === `OFC-AGE-${d}`);
      if (!claim) {
        log.record('B Age', 'gate', `Age ${d} days`, 'FAIL', 'claim missing after import');
        continue;
      }
      const wasDialled = dialled.includes(claim.id);
      const escalated = escalations.some((e) => e.claimId === claim.id);
      const onWorkList = workItems.some((w) => w.sourceId === claim.id);
      const shouldDial = d >= 30 && d <= 90;
      const queued = Boolean(claim.queueEntry);
      let status: 'PASS' | 'FAIL' | 'FINDING' = wasDialled === shouldDial ? 'PASS' : 'FAIL';
      let note = `dialled=${wasDialled} queued=${queued} callEscalation=${escalated} workList=${onWorkList} claimStatus=${claim.status}`;
      if (d > 90 && !wasDialled && !escalated) {
        status = onWorkList ? 'PASS' : 'FINDING';
        note += onWorkList
          ? '. Not dialled and no call escalation row, but it is on the staff work list as a manual item.'
          : '. Rule: over 90 days skips AI and escalates to a human. No queue entry, no escalation and no work item: invisible to staff.';
      }
      log.record('B Age', 'validateDispatch', `Age ${d} days ${shouldDial ? 'dials' : d < 30 ? 'waits' : 'escalates'}`, status, note);
    }
    log.record('B Age', 'enqueue', 'Claims under 30 days are rechecked as they age', 'UNVERIFIED',
      'Needs time travel across days. If a 10-day claim is never re-evaluated at day 30 the practice never recovers it; confirm the aging sweep in a staging soak.');
  }, 180_000);

  it('C. call window: weekends, edge minutes, holidays and western offices', async () => {
    delete process.env.COLLECTRX_FORCE_CALL_WINDOW;
    const slots: Array<{ label: string; iso: string; tz: string; expectDial: boolean; note?: string }> = [
      { label: 'Wednesday 07:59 ET', iso: '2026-11-18T12:59:00Z', tz: 'America/Toronto', expectDial: false },
      { label: 'Wednesday 08:00 ET', iso: '2026-11-18T13:00:00Z', tz: 'America/Toronto', expectDial: true },
      { label: 'Wednesday 16:59 ET', iso: '2026-11-18T21:59:00Z', tz: 'America/Toronto', expectDial: true },
      { label: 'Wednesday 17:00 ET', iso: '2026-11-18T22:00:00Z', tz: 'America/Toronto', expectDial: false },
      { label: 'Saturday 10:00 ET', iso: '2026-11-14T15:00:00Z', tz: 'America/Toronto', expectDial: false },
      { label: 'Sunday 10:00 ET', iso: '2026-11-15T15:00:00Z', tz: 'America/Toronto', expectDial: false },
      { label: 'Christmas Day (Fri) 10:00 ET', iso: '2026-12-25T15:00:00Z', tz: 'America/Toronto', expectDial: false, note: 'statutory holiday: carrier lines closed' },
      { label: 'Canada Day 2027 (Thu) 10:00 ET', iso: '2027-07-01T14:00:00Z', tz: 'America/Toronto', expectDial: false, note: 'statutory holiday: carrier lines closed' },
      { label: 'Wednesday 08:00 ET for a Vancouver office (05:00 PT)', iso: '2026-11-18T13:00:00Z', tz: 'America/Vancouver', expectDial: false, note: 'staff must be present to take the transfer; the office is closed' },
    ];
    for (const slot of slots) {
      const office = await makeOffice({ label: `C window ${slot.label}`, timezone: slot.tz });
      const rows = [officeRow('WIN', { days: 45 })];
      await importCsv(office.id, toOfficeCsv(rows), rows);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(slot.iso));
      const t = await tickFor(office.id);
      vi.useRealTimers();
      const dialled = t.dials.length > 0;
      await freeLines(office.id);
      const ok = dialled === slot.expectDial;
      const lacksHolidayAwareness = !slot.expectDial && dialled && /Christmas|Canada Day/u.test(slot.label);
      const lacksStaffHours = !slot.expectDial && dialled && slot.tz !== 'America/Toronto';
      const undocumentedRule = Boolean(slot.note) && !slot.expectDial;
      log.record('C Window', 'validateDispatch', slot.label, ok ? 'PASS' : undocumentedRule ? 'FINDING' : 'FAIL',
        `dialled=${dialled} expected=${slot.expectDial}${slot.note ? `. ${slot.note}` : ''}${lacksHolidayAwareness ? '. No holiday calendar exists in the call-window check.' : ''}${lacksStaffHours ? '. The window is hardcoded Eastern; a western office is dialled before its staff arrive, and a Hold Sentinel call needs staff to answer the transfer.' : ''}`);
    }
  }, 180_000);

  it('D. calls that never connect: no answer, silence, carrier error, dropped line', async () => {
    const office = await makeOffice({ label: 'D failed calls' });
    const reasons = ['customer-did-not-answer', 'silence-timed-out', 'twilio-failed-to-connect-call', 'phone-call-provider-closed-websocket', 'assistant-error', 'exceeded-max-duration'];
    const rows = reasons.map((r) => officeRow('FAILCALL', { claimNumber: `OFC-FAIL-${r}`, days: 50 }));
    await importCsv(office.id, toOfficeCsv(rows), rows);
    for (const reason of reasons) {
      const t = await tickFor(office.id);
      const claimId = t.claimIds[0];
      if (!claimId) {
        log.record('D Failed calls', 'dispatch', `${reason}: call placed`, 'UNVERIFIED', 'tick made no dial');
        continue;
      }
      const attempt = await attemptFor(claimId);
      if (!attempt) continue;
      const before = await plain.callQueue.findUnique({ where: { claimId } });
      const meta = dialMeta.get(claimId) ?? {};
      await postWebhook({ message: { type: 'status-update', status: 'in-progress', call: { id: attempt.vapiCallId, startedAt: attempt.initiatedAt.toISOString(), assistantOverrides: { metadata: meta } } } });
      const res = await postWebhook(endOfCall(attempt.vapiCallId, attempt.initiatedAt, reason, reason === 'exceeded-max-duration' ? 2700 : reason === 'assistant-error' ? 15 : 0, meta));
      const claim = await plain.insuranceClaim.findUnique({ where: { id: claimId } });
      const queue = await plain.callQueue.findUnique({ where: { claimId } });
      const done = await plain.callAttempt.findUnique({ where: { id: attempt.id } });
      const stuck = claim?.status === 'CALLING' || !done?.completedAt;
      log.record('D Failed calls', 'webhook', `Ended reason ${reason}`, !stuck && res.status === 200 ? 'PASS' : 'FAIL',
        `HTTP ${res.status} claim=${claim?.status} attemptCompleted=${Boolean(done?.completedAt)} outcome=${done?.outcome ?? 'null'} queue ${before?.status}->${queue?.status} attempts ${before?.attempts}->${queue?.attempts} recall=${queue?.nextRecallAt?.toISOString() ?? 'none'} minutesBilled=${done?.minutesBilled ?? 'null'}`);
      const billedNoAnswer = (reason === 'customer-did-not-answer' || reason === 'twilio-failed-to-connect-call') && (done?.minutesBilled ?? 0) > 0;
      if (billedNoAnswer) log.record('D Failed calls', 'metering', `A zero-second call (${reason}) is not billed to the practice`, 'FINDING', `0 seconds reported, minutesBilled=${done?.minutesBilled}. A one-minute minimum on a call that never connected eats the practice's included minutes and is hard to explain on an invoice.`);
      const immediate = queue?.status === 'PENDING' && !queue.nextRecallAt && queue.scheduledFor.getTime() <= Date.now();
      if (immediate) log.record('D Failed calls', 'retry', `After ${reason} the claim is eligible for redial immediately`, 'FINDING', `queue PENDING, nextRecallAt=none, scheduledFor=${queue?.scheduledFor.toISOString()} (past). The next 60-second tick can call the same carrier again.`);
      await freeLines(office.id);
    }
  }, 180_000);

  it('E. repeated failed calls: how fast are retries, and does the third failure reach staff', async () => {
    const office = await makeOffice({ label: 'E retries' });
    const rows = [officeRow('RETRY', { claimNumber: 'OFC-RETRY-1', days: 55 })];
    await importCsv(office.id, toOfficeCsv(rows), rows);
    const claim = await plain.insuranceClaim.findFirst({ where: { practiceId: office.id } });
    if (!claim) return;
    let dials = 0;
    let backToBack = 0;
    let forced = 0;
    for (let i = 0; i < 6; i += 1) {
      let t = await tickFor(office.id);
      if (t.dials.length === 0) {
        const q = await plain.callQueue.findUnique({ where: { claimId: claim.id } });
        if (q?.status === 'ESCALATED') break;
        await plain.callQueue.updateMany({ where: { claimId: claim.id, status: 'PENDING' }, data: { scheduledFor: new Date('2026-01-01T00:00:00Z'), nextRecallAt: null } });
        t = await tickFor(office.id);
        if (t.dials.length > 0) forced += 1;
      } else if (i > 0) {
        backToBack += 1;
      }
      if (t.dials.length === 0) break;
      dials += 1;
      await finishCall(claim.id, 'customer-did-not-answer', 0);
    }
    const escalated = await plain.callEscalation.findFirst({ where: { practiceId: office.id, claimId: claim.id } });
    const after = await plain.insuranceClaim.findUnique({ where: { id: claim.id } });
    log.record('E Retries', 'claimRouter', 'Fruitless calls stop at or below the 3-attempt cap and reach staff', dials <= 3 && Boolean(escalated) ? 'PASS' : 'FAIL',
      `dials=${dials} escalation row=${Boolean(escalated)} claimStatus=${after?.status}. By design (claimRouter.ts) two attempts with no engagement escalate, so the documented 3-attempt cap is a ceiling, not the usual path.`);
    log.record('E Retries', 'spacing', 'Retries after a failed call are spaced out', backToBack === 0 ? 'PASS' : 'FINDING',
      `${backToBack} retry dial(s) happened on consecutive ticks with no spacing (${forced} needed a forced schedule). A busy or closed carrier line gets three calls inside a few minutes and the claim is escalated before the line could have recovered.`);
  }, 120_000);

  it('F. CARRIER_BLOCK scope: one carrier blocks, the others keep working, and clearing it recovers every claim', async () => {
    const office = await makeOffice({ label: 'F carrier block' });
    const rows = [
      officeRow('BLK', { claimNumber: 'OFC-BLK-SL-1', carrier: 'Sun Life', days: 45 }),
      officeRow('BLK', { claimNumber: 'OFC-BLK-SL-2', carrier: 'Sun Life', days: 52 }),
      officeRow('BLK', { claimNumber: 'OFC-BLK-MF-1', carrier: 'Manulife', days: 47 }),
      officeRow('BLK', { claimNumber: 'OFC-BLK-GS-1', carrier: 'Green Shield', days: 61 }),
    ];
    await importCsv(office.id, toOfficeCsv(rows), rows);
    await applyCarrierBlock(prisma, { practiceId: office.id, carrierId: 'sun_life' as CarrierId, vapiCallId: 'sim-block-origin', reason: 'Simulated: carrier flagged automation', hangVapi: false });
    const dialled = await drain(office.id);
    const claims = await plain.insuranceClaim.findMany({ where: { practiceId: office.id } });
    const idOf = (n: string): string => claims.find((c) => c.claimNumber === n)?.id ?? '';
    const sunLifeDialled = dialled.filter((id) => id === idOf('OFC-BLK-SL-1') || id === idOf('OFC-BLK-SL-2')).length;
    log.record('F Block', 'dispatch', 'No Sun Life claim is dialled while blocked', sunLifeDialled === 0 ? 'PASS' : 'FAIL', `sun_life dials=${sunLifeDialled}`);
    log.record('F Block', 'dispatch', 'Other carriers continue to be worked', dialled.includes(idOf('OFC-BLK-MF-1')) && dialled.includes(idOf('OFC-BLK-GS-1')) ? 'PASS' : 'FAIL',
      `manulife dialled=${dialled.includes(idOf('OFC-BLK-MF-1'))} green_shield dialled=${dialled.includes(idOf('OFC-BLK-GS-1'))}`);
    const blockedStatus = await plain.callQueue.findMany({ where: { practiceId: office.id, claim: { carrierId: 'sun_life' } }, select: { status: true, dispatchDeferralCode: true } });
    log.record('F Block', 'visibility', 'Blocked claims carry a staff-visible reason', blockedStatus.every((q) => q.dispatchDeferralCode === 'CARRIER_BLOCK') ? 'PASS' : 'FINDING',
      JSON.stringify(blockedStatus));
    const cleared = await clearCarrierBlock(prisma, office.id, 'sun_life' as CarrierId, office.staffId, 'Simulated review complete');
    const afterClear = await drain(office.id);
    const recovered = [idOf('OFC-BLK-SL-1'), idOf('OFC-BLK-SL-2')].filter((id) => afterClear.includes(id)).length;
    log.record('F Block', 'recovery', 'Clearing the block resumes every held claim', cleared && recovered === 2 ? 'PASS' : 'FAIL',
      `cleared=${cleared} sun_life claims dialled after clear=${recovered} of 2`);
    const mfAfter = await plain.insuranceClaim.findUnique({ where: { id: idOf('OFC-BLK-MF-1') } });
    log.record('F Block', 'scope', 'Block events are scoped to the practice that triggered them', 'UNVERIFIED',
      `Carrier-wide suspension across practices is the documented rule ("all calls to that carrier"); this run uses one practice. Cross-practice behaviour is exercised in G. Manulife claim status now ${mfAfter?.status}.`);
  }, 180_000);

  it('G. two practices, one carrier: tenant isolation and a block raised by the neighbour', async () => {
    const a = await makeOffice({ label: 'G practice A' });
    const b = await makeOffice({ label: 'G practice B' });
    const rowsA = [officeRow('TEN', { claimNumber: 'OFC-SHARED-1', carrier: 'Canada Life', days: 40 })];
    const rowsB = [officeRow('TEN', { claimNumber: 'OFC-SHARED-1', carrier: 'Canada Life', days: 40 })];
    await importCsv(a.id, toOfficeCsv(rowsA), rowsA);
    await importCsv(b.id, toOfficeCsv(rowsB), rowsB);
    const countA = await plain.insuranceClaim.count({ where: { practiceId: a.id, claimNumber: 'OFC-SHARED-1' } });
    const countB = await plain.insuranceClaim.count({ where: { practiceId: b.id, claimNumber: 'OFC-SHARED-1' } });
    log.record('G Tenants', 'import', 'Same claim number in two practices stays two claims', countA === 1 && countB === 1 ? 'PASS' : 'FAIL', `A=${countA} B=${countB}`);

    const t = await tickFor(a.id);
    const dialledClaim = t.claimIds[0] ? await plain.insuranceClaim.findUnique({ where: { id: t.claimIds[0] } }) : null;
    const attempt = t.claimIds[0] ? await attemptFor(t.claimIds[0]) : null;
    if (dialledClaim && attempt) {
      const owner = dialledClaim.practiceId === a.id ? a : b;
      const intruder = owner === a ? b : a;
      const res = await request(deskApp)
        .post(`/api/desk/${owner.id}/active/takeover`)
        .set('Authorization', `Bearer ${intruder.token}`)
        .send({ phoneNumber: ESCALATION_PHONE, staffId: intruder.staffId, callAttemptId: attempt.id, vapiCallId: attempt.vapiCallId });
      const transferred = interceptor.transfers().some((x) => x.path.includes(attempt.vapiCallId));
      log.record('G Tenants', 'desk API', 'Another practice cannot take over this practice\'s live call', res.status >= 400 && !transferred ? 'PASS' : 'FAIL',
        `HTTP ${res.status} transferred=${transferred}`);
      const peek = await request(deskApp).get(`/api/desk/${owner.id}/active`).set('Authorization', `Bearer ${intruder.token}`);
      log.record('G Tenants', 'desk API', 'Another practice cannot list this practice\'s live calls', peek.status >= 400 ? 'PASS' : 'FAIL', `HTTP ${peek.status}`);
    } else {
      log.record('G Tenants', 'desk API', 'Cross-tenant takeover attempt', 'UNVERIFIED', 'no live call was produced');
    }
    await freeLines(a.id);
    await freeLines(b.id);

    await applyCarrierBlock(prisma, { practiceId: a.id, carrierId: 'canada_life' as CarrierId, vapiCallId: 'sim-block-neighbour', reason: 'Simulated neighbour block', hangVapi: false });
    const rowsB2 = [officeRow('TEN2', { claimNumber: 'OFC-NEIGHBOUR-1', carrier: 'Canada Life', days: 44 })];
    await importCsv(b.id, toOfficeCsv(rowsB2), rowsB2);
    await plain.callQueue.updateMany({ where: { practiceId: b.id }, data: { status: 'PENDING', scheduledFor: new Date('2026-01-01T00:00:00Z') } });
    const neighbour = await tickFor(b.id);
    const bDialled = neighbour.claimIds.some((id) => id.length > 0);
    log.record('G Tenants', 'CARRIER_BLOCK', 'A block raised by practice A on a carrier pauses practice B too (documented: all calls to that carrier)', bDialled ? 'FINDING' : 'PASS',
      `practice B dialled Canada Life after practice A's block=${bDialled}. The rule says suspend all calls to the carrier; the block record is per practice, so B continues unless an organization link exists.`);
    await freeLines(b.id);
  }, 180_000);

  it('H. webhook hygiene: bad signature, unknown call, duplicate end-of-call, end before start', async () => {
    const office = await makeOffice({ label: 'H webhooks' });
    const rows = [officeRow('HOOK', { claimNumber: 'OFC-HOOK-1', days: 48 }), officeRow('HOOK', { claimNumber: 'OFC-HOOK-2', days: 49 })];
    await importCsv(office.id, toOfficeCsv(rows), rows);
    const first = await tickFor(office.id);
    const claimId = first.claimIds[0];
    const attempt = claimId ? await attemptFor(claimId) : null;
    if (!claimId || !attempt) {
      log.record('H Webhooks', 'dispatch', 'A call was produced for webhook tests', 'UNVERIFIED', 'tick made no dial');
      return;
    }
    const meta = dialMeta.get(claimId) ?? {};
    const body = endOfCall(attempt.vapiCallId, attempt.initiatedAt, 'customer-ended-call', 600, meta, 'Rep: thanks\nStaff: thanks');

    const bad = await postWebhookRaw(JSON.stringify(body), 'sha256=deadbeef');
    const unsigned = await request(webhookApp).post('/api/webhooks/vapi').set('Content-Type', 'application/json').send(JSON.stringify(body));
    log.record('H Webhooks', 'auth', 'Wrong or missing signature is rejected', bad.status === 401 && unsigned.status === 401 ? 'PASS' : 'FAIL', `bad HTTP ${bad.status}, missing HTTP ${unsigned.status}`);

    const ghost = await postWebhook(endOfCall('sim-ghost-call', new Date(), 'customer-ended-call', 30, {}));
    log.record('H Webhooks', 'robustness', 'End-of-call for a call we never placed does not error or create data', ghost.status < 500 ? 'PASS' : 'FAIL', `HTTP ${ghost.status}`);

    const ahead = await postWebhook(body);
    const afterOne = await plain.callAttempt.findUnique({ where: { id: attempt.id } });
    const usageOne = await plain.callAttempt.aggregate({ where: { claim: { practiceId: office.id } }, _sum: { minutesBilled: true } });
    log.record('H Webhooks', 'ordering', 'End-of-call arriving with no earlier status update still closes the attempt', afterOne?.completedAt ? 'PASS' : 'FAIL',
      `HTTP ${ahead.status} completed=${Boolean(afterOne?.completedAt)} billed=${afterOne?.minutesBilled ?? 'null'}`);

    const dup = await postWebhook(body);
    const usageTwo = await plain.callAttempt.aggregate({ where: { claim: { practiceId: office.id } }, _sum: { minutesBilled: true } });
    const period = await plain.usagePeriod.findMany({ where: { practiceId: office.id } });
    log.record('H Webhooks', 'idempotency', 'Vapi redelivering the same end-of-call does not bill the minutes twice', (usageTwo._sum.minutesBilled ?? 0) === (usageOne._sum.minutesBilled ?? 0) ? 'PASS' : 'FAIL',
      `HTTP ${dup.status} billed before=${usageOne._sum.minutesBilled ?? 0} after=${usageTwo._sum.minutesBilled ?? 0} usage periods=${JSON.stringify(period.map((p) => ({ used: (p as unknown as { minutesUsed?: unknown }).minutesUsed })))}`);

    const stale = await postWebhook({ message: { type: 'status-update', status: 'in-progress', call: { id: attempt.vapiCallId, startedAt: attempt.initiatedAt.toISOString(), assistantOverrides: { metadata: meta } } } });
    const afterStale = await plain.callAttempt.findUnique({ where: { id: attempt.id } });
    log.record('H Webhooks', 'ordering', 'A late in-progress update does not reopen a finished call', afterStale?.completedAt ? 'PASS' : 'FAIL', `HTTP ${stale.status} completed=${Boolean(afterStale?.completedAt)}`);
    await freeLines(office.id);
  }, 120_000);

  it('I. re-import after a claim closed: no resurrection, no duplicates', async () => {
    const office = await makeOffice({ label: 'I reimport' });
    const rows = [officeRow('REIMP', { claimNumber: 'OFC-REIMP-1', days: 46 }), officeRow('REIMP', { claimNumber: 'OFC-REIMP-2', days: 47 })];
    const csv = toOfficeCsv(rows);
    await importCsv(office.id, csv, rows);
    const closed = await plain.insuranceClaim.findFirst({ where: { practiceId: office.id, claimNumber: 'OFC-REIMP-1' } });
    if (!closed) return;
    await plain.insuranceClaim.update({ where: { id: closed.id }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
    await plain.callQueue.updateMany({ where: { claimId: closed.id }, data: { status: 'COMPLETED' } });
    const again = await importCsv(office.id, csv, rows);
    const reopened = await plain.insuranceClaim.findUnique({ where: { id: closed.id }, include: { queueEntry: true } });
    const total = await plain.insuranceClaim.count({ where: { practiceId: office.id } });
    log.record('I Reimport', 'import', 'Re-importing the same export creates no duplicate claims', total === 2 ? 'PASS' : 'FAIL', `claims=${total} second import status=${again.status} threw=${again.threw ?? 'no'}`);
    log.record('I Reimport', 'import', 'A resolved claim is not reopened or re-queued by the next nightly export', reopened?.status === 'RESOLVED' && reopened.queueEntry?.status !== 'PENDING' ? 'PASS' : 'FAIL',
      `status=${reopened?.status} queue=${reopened?.queueEntry?.status}. PMS exports keep listing a claim until the practice posts the payment, so this happens every night.`);
  }, 120_000);

  it('K. authorization and voice gates: a practice that is not set up never dials, and says why', async () => {
    const noAuth = await makeOffice({ label: 'K no authorization letters', authorizeCarriers: false });
    const noVoice = await makeOffice({ label: 'K voice off', voiceAgentEnabled: false });
    for (const [label, office] of [['no carrier authorization', noAuth], ['voice agent disabled', noVoice]] as const) {
      const rows = [officeRow('GATE', { days: 45 })];
      await importCsv(office.id, toOfficeCsv(rows), rows);
      const t = await tickFor(office.id);
      const q = await plain.callQueue.findFirst({ where: { practiceId: office.id } });
      log.record('K Gates', 'dispatch', `Practice with ${label} does not dial`, t.dials.length === 0 ? 'PASS' : 'FAIL', `dials=${t.dials.length}`);
      log.record('K Gates', 'visibility', `Practice with ${label} is told why nothing is happening`, q?.dispatchDeferralCode ? 'PASS' : 'FINDING',
        `queue status=${q?.status} deferralCode=${q?.dispatchDeferralCode ?? 'none'} nextAction=${q?.dispatchDeferralNextAction ? 'present' : 'none'}. A queue row with no reason reads as a broken product on day one of a pilot; any dashboard banner outside the queue row is not covered by this run.`);
    }
  }, 120_000);

  it('L. TELUS AdjudiCare: never dialled without a verified per-TPA line', async () => {
    const office = await makeOffice({ label: 'L telus' });
    const rows = [
      officeRow('TEL', { claimNumber: 'OFC-TEL-1', carrier: 'TELUS Health', group: 'A100200', days: 45 }),
      officeRow('TEL', { claimNumber: 'OFC-TEL-2', carrier: 'TELUS AdjudiCare', group: '', days: 46 }),
    ];
    await importCsv(office.id, toOfficeCsv(rows), rows);
    const dialled = await drain(office.id, 6);
    const claims = await plain.insuranceClaim.findMany({ where: { practiceId: office.id } });
    const escalations = await plain.callEscalation.count({ where: { practiceId: office.id } });
    const generic = interceptor.dials().some((d) => JSON.stringify(d.body).includes('+18772893343'));
    log.record('L TELUS', 'dispatch', 'No call goes to the placeholder TELUS number', generic ? 'FAIL' : 'PASS', `dials to placeholder line=${generic}`);
    log.record('L TELUS', 'handoff', 'Undialable TELUS claims are handed to staff, not left silent', escalations > 0 ? 'PASS' : 'FINDING',
      `dialled=${dialled.length} escalations=${escalations} statuses=${claims.map((c) => `${c.claimNumber}:${c.status}`).join(', ')}. About a quarter of Canadian dental plans route through TELUS; the practice needs to know those claims are theirs to chase.`);
  }, 120_000);

  it('M. whole-day PHI sweep: database, and every outbound request outside call variables', async () => {
    const hits = await sweepTables(phiValues);
    log.record('M PHI', 'database', 'Zero plaintext synthetic PHI in any table after a full office day', hits.length === 0 ? 'PASS' : 'FAIL',
      hits.length === 0 ? `scanned ${phiValues.length} values across all public tables` : JSON.stringify(hits));
    const offenders: string[] = [];
    for (const req of interceptor.requests) {
      if (req.disposition === 'vapi_stub' && typeof req.body === 'object' && req.body !== null) {
        const copy = JSON.parse(JSON.stringify(req.body)) as { assistantOverrides?: { variableValues?: unknown } };
        if (copy.assistantOverrides) delete copy.assistantOverrides.variableValues;
        const text = JSON.stringify(copy).toLowerCase();
        for (const v of phiValues) if (text.includes(v.toLowerCase())) offenders.push(`${req.path}:${v}`);
      } else if (req.disposition === 'anthropic_stub') {
        const text = JSON.stringify(req.body).toLowerCase();
        for (const v of phiValues) if (text.includes(v.toLowerCase())) offenders.push(`anthropic:${v}`);
      }
    }
    log.record('M PHI', 'egress', 'No PHI in Vapi payloads outside variableValues, nor in any LLM request', offenders.length === 0 ? 'PASS' : 'FAIL',
      offenders.length === 0 ? `${interceptor.requests.length} outbound requests inspected` : offenders.slice(0, 5).join('; '));
    expect(interceptor.blocked()).toHaveLength(0);
  }, 120_000);
});
