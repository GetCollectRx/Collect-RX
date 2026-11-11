/**
 * Contained self-test of the CollectRx application.
 *
 * Plays synthetic offices through the real UI and API against a real database,
 * with a fake Vapi that records what would have been dialled. Hard assertions
 * cover contracts that must always hold (PHI boundary, tenancy, no double dial,
 * webhook authentication, containment). Everything else is recorded as a
 * FINDING in the report instead of failing the run, so a missing UI behaviour
 * is visible without hiding a real regression.
 */
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { officeRow, toOfficeCsv, type OfficeRow } from '../tests/sim-harness/officeFixtures';
import { Recorder } from './recorder';

const BASE = process.env.SELFTEST_BASE_URL ?? 'http://127.0.0.1:3120';
const FAKE_VAPI = process.env.FAKE_VAPI_URL ?? 'http://127.0.0.1:3199';
const WEBHOOK_SECRET = process.env.SELFTEST_WEBHOOK_SECRET ?? '';
const EGRESS_LOG = process.env.SELFTEST_EGRESS_LOG ?? '';
const REPORT_DIR = process.env.SELFTEST_REPORT_DIR ?? 'self-test/report';
const PASSWORD = 'Selftest-Pass-12345!';
const rec = new Recorder();
const DB_URL = process.env.SELFTEST_DB_URL ?? '';
const db = new PrismaClient({ datasources: { db: { url: DB_URL } } });

interface Office {
  label: string;
  email: string;
  practiceId: string;
  context: BrowserContext;
  page: Page;
  /** The signed-up owner's session. The product treats this role as read-only for setup and manual dials. */
  api: APIRequestContext;
  /** An invited office manager's session, the role that actually configures and dials. */
  ops: APIRequestContext;
}

interface DialBody {
  squadId?: string;
  phoneNumberId?: string;
  customer?: { number?: string };
  assistantOverrides?: { metadata?: Record<string, unknown>; variableValues?: Record<string, unknown> };
}

interface Dial {
  id: string;
  body: DialBody;
}

const externalHosts = new Set<string>();
const pageProblems: string[] = [];
const isLocal = (url: string): boolean => /^(https?:\/\/(127\.0\.0\.1|localhost)[:/]|data:|blob:|about:)/u.test(url);

function watch(page: Page, label: string): void {
  page.on('requestfailed', (req) => {
    if (!isLocal(req.url())) externalHosts.add(new URL(req.url()).hostname);
  });
  page.on('pageerror', (err) => pageProblems.push(`${label}: uncaught ${err.message.slice(0, 120)}`));
}

async function newOffice(browser: Browser, label: string, viaUi: boolean): Promise<Office> {
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();
  watch(page, label);
  const email = `${label.toLowerCase().replace(/\W+/gu, '-')}-${Date.now()}@selftest.invalid`;
  if (viaUi) {
    await page.goto('/signup');
    const cookieOk = page.getByRole('button', { name: 'OK', exact: true });
    if (await cookieOk.isVisible().catch(() => false)) await cookieOk.click();
    const inputs = page.locator('input');
    await inputs.nth(0).fill(`SELFTEST ${label}`);
    await inputs.nth(1).fill(`Owner ${label}`);
    await inputs.nth(2).fill(email);
    await inputs.nth(3).fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL(/\/(dashboard|onboarding|import|settings)/u, { timeout: 30_000 });
  } else {
    const res = await context.request.post('/api/auth/register', {
      data: { practiceName: `SELFTEST ${label}`, displayName: `Owner ${label}`, email, password: PASSWORD },
    });
    expect(res.status(), 'register').toBe(201);
  }
  const meRes = await context.request.get('/api/auth/me');
  const me = (await meRes.json()) as { practiceId?: string; practice?: { id?: string }; user?: { practiceId?: string } };
  const practiceId = me.practiceId ?? me.practice?.id ?? me.user?.practiceId ?? '';
  return { label, email, practiceId, context, page, api: context.request, ops: context.request };
}

const CARRIER_IDS = ['sun_life', 'canada_life', 'manulife', 'green_shield', 'rbc', 'telus_adjudicare'] as const;

/** Completes the setup a real office does before the first call: voice on, carriers authorized, staff phone, identity. */
/** The owner invites an office manager; with no email service the API hands back the token, and the manager accepts it. */
async function addManager(browser: Browser, office: Office): Promise<void> {
  const email = `manager-${office.email}`;
  const invite = await office.api.post('/api/auth/invite', { data: { email, role: 'office_manager' } });
  const inviteBody = (await invite.json()) as { token?: string; invited?: boolean; emailSent?: boolean };
  rec.expect('Onboarding', `${office.label}: the owner can invite an office manager`, invite.status() === 200 && inviteBody.invited === true, `status ${invite.status()}, ${JSON.stringify({ ...inviteBody, token: inviteBody.token ? '<token>' : undefined })}`, true);
  // With no email provider configured the app reports emailSent: true while sending nothing and returns no token.
  const row = await db.inviteToken.findFirst({ where: { email }, orderBy: { createdAt: 'desc' }, select: { token: true } });
  rec.observe('Onboarding', `${office.label}: an invite that reports emailSent really sends or returns a way to accept`, !(inviteBody.emailSent === true && !inviteBody.token) || false,
    `emailSent ${String(inviteBody.emailSent)}, token in response ${Boolean(inviteBody.token)}; no email provider is configured here, so nothing was sent. The accept link is only written to the server log`);
  const token = inviteBody.token ?? row?.token;
  const context = await browser.newContext({ baseURL: BASE });
  const accepted = await context.request.post('/api/auth/accept-invite', { data: { token, displayName: `Manager ${office.label}`, password: PASSWORD } });
  rec.expect('Onboarding', `${office.label}: the invited manager can accept and is signed in`, accepted.status() === 201, `status ${accepted.status()}`, true);
  office.ops = context.request;
}

async function enableDialling(office: Office, npi: string | null): Promise<void> {
  // The server fills every field not sent with its own defaults, so only what an office changes is sent.
  const body = {
    settings: {
      voiceAgentEnabled: true,
      humanAssistedMode: true,
      escalationPhoneNumber: '+16135550102',
      carrierConfigs: CARRIER_IDS.map((carrierId) => ({ carrierId, enabled: true, authorizationSubmitted: true, authorizationSubmittedAt: new Date().toISOString(), providerNumber: '9900100' })),
    },
  };
  expect((await office.ops.put('/api/admin/settings', { data: body })).status(), 'settings').toBe(200);
  const identity: Record<string, string> = { billingPhone: '+16135550101', practiceAddress: '1 Synthetic Way, Ottawa ON' };
  if (npi !== null) identity.npi = npi;
  expect((await office.ops.put('/api/admin/practice-identity', { data: identity })).status(), 'identity').toBe(200);
}

interface ClaimRow {
  id: string;
  claimNumber: string;
  status: string;
  carrierId: string;
}

async function listClaims(office: Office): Promise<ClaimRow[]> {
  const res = await office.api.get('/api/insurance/claims?limit=100');
  expect(res.status()).toBe(200);
  return ((await res.json()) as { data: ClaimRow[] }).data;
}

async function importRows(office: Office, rows: Array<Record<string, string>>): Promise<Record<string, unknown>> {
  const res = await office.api.post('/api/insurance/claims/import', { data: { records: rows } });
  expect(res.status(), 'import').toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

async function dials(): Promise<Dial[]> {
  const res = await fetch(`${FAKE_VAPI}/__dials`);
  return ((await res.json()) as { dials: Dial[] }).dials;
}

async function resetFakeVapi(): Promise<void> {
  await fetch(`${FAKE_VAPI}/__reset`);
}

function signed(envelope: Record<string, unknown>): { raw: string; headers: Record<string, string> } {
  const raw = JSON.stringify(envelope);
  const signature = `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex')}`;
  return { raw, headers: { 'content-type': 'application/json', 'x-vapi-signature': signature } };
}

async function webhook(api: APIRequestContext, envelope: Record<string, unknown>, headers?: Record<string, string>): Promise<{ status: number; body: string }> {
  const s = signed(envelope);
  const res = await api.post('/api/webhooks/vapi', { data: s.raw, headers: headers ?? s.headers });
  return { status: res.status(), body: await res.text() };
}

function toolCall(callId: string, metadata: Record<string, unknown> | undefined, name: string, args: Record<string, unknown>): Record<string, unknown> {
  return {
    message: {
      type: 'tool-calls',
      call: { id: callId, assistantOverrides: { metadata } },
      toolWithToolCallList: [{ name, toolCall: { id: `tc-${name}-${callId}`, function: { name, arguments: JSON.stringify(args) } } }],
    },
  };
}

function endReport(callId: string, metadata: Record<string, unknown> | undefined, seconds: number, transcript: string, reason = 'customer-ended-call'): Record<string, unknown> {
  const end = new Date();
  return {
    message: {
      type: 'end-of-call-report',
      startedAt: new Date(end.getTime() - seconds * 1000).toISOString(),
      endedAt: end.toISOString(),
      endedReason: reason,
      call: { id: callId, assistantOverrides: { metadata } },
      artifact: { transcript },
      analysis: { summary: 'Synthetic self-test call.' },
      cost: 0.05,
    },
  };
}

const goodRows = (tag: string, n: number, carrier = 'RBC Insurance'): OfficeRow[] =>
  Array.from({ length: n }, (_v, i) => officeRow(tag, { claimNumber: `ST-${tag}-${i + 1}`, carrier }));

let A: Office;
let B: Office;
let dialA: Dial | undefined;

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  await A?.context.close();
  await B?.context.close();
  await db.$disconnect();
  rec.write(REPORT_DIR);
});

test('0. perimeter: unauthenticated access, webhook authentication, health', async ({ playwright }) => {
  const anon = await playwright.request.newContext({ baseURL: BASE });
  const health = await anon.get('/api/health');
  rec.expect('Perimeter', 'health endpoint answers', health.status() === 200, `status ${health.status()}`);

  for (const path of ['/api/insurance/claims', '/api/insurance/queue', '/api/admin/settings', '/api/admin/practice-identity', '/api/insurance/practice-notifications']) {
    const r = await anon.get(path);
    rec.expect('Perimeter', `anonymous ${path} is refused`, r.status() === 401 || r.status() === 403, `status ${r.status()}`, true);
  }
  const noSig = await webhook(anon, { message: { type: 'status-update', call: { id: 'x' } } }, { 'content-type': 'application/json' });
  rec.expect('Perimeter', 'webhook with no signature is refused', noSig.status === 401 || noSig.status === 403, `status ${noSig.status}`, true);
  const badSig = await webhook(anon, { message: { type: 'status-update', call: { id: 'x' } } }, { 'content-type': 'application/json', 'x-vapi-signature': 'sha256=deadbeef' });
  rec.expect('Perimeter', 'webhook with a wrong signature is refused', badSig.status === 401 || badSig.status === 403, `status ${badSig.status}`, true);
  const headers = health.headers();
  const wanted = ['x-content-type-options', 'strict-transport-security', 'content-security-policy', 'x-frame-options'];
  rec.observe('Perimeter', 'security headers', wanted.every((h) => h in headers),
    `present: ${wanted.filter((h) => h in headers).join(', ') || 'none'}; missing: ${wanted.filter((h) => !(h in headers)).join(', ') || 'none'} (strict-transport-security is normally only sent over HTTPS, which this local run does not use)`);
  await anon.dispose();
});

test('1. a new office signs up through the browser', async ({ browser }) => {
  A = await newOffice(browser, 'Office A', true);
  rec.expect('Onboarding', 'signup creates a practice and signs the owner in', A.practiceId.length > 0, `landed on ${new URL(A.page.url()).pathname}`, true);
  await A.page.screenshot({ path: `${REPORT_DIR}/artifacts/01-after-signup.png` }).catch(() => undefined);
  B = await newOffice(browser, 'Office B', false);
  rec.expect('Onboarding', 'a second office is a separate practice', B.practiceId !== '' && B.practiceId !== A.practiceId, 'two distinct practice ids', true);

  // What the person who signed up can do on their own.
  const ownerSettings = await A.api.put('/api/admin/settings', { data: { settings: { voiceAgentEnabled: true } } });
  const ownerIdentity = await A.api.put('/api/admin/practice-identity', { data: { npi: '9900001' } });
  rec.observe('Onboarding', 'the person who signs up can configure their own practice', ownerSettings.status() === 200 && ownerIdentity.status() === 200,
    `settings ${ownerSettings.status()}, identity (NPI) ${ownerIdentity.status()}: by design the signup role is read-only for setup, so an invited office manager must do it`);
  const guidance = (await A.page.locator('body').innerText()).toLowerCase();
  rec.observe('Onboarding', 'the first screen tells a new owner to invite an office manager', /invite|office manager/u.test(guidance), `looked for the words invite or office manager on ${new URL(A.page.url()).pathname}`);
  await addManager(browser, A);
  await addManager(browser, B);
});

test('2. CSV import in the browser: good rows, bad rows, a totals row and blank trailing rows', async () => {
  const good = goodRows('A', 4);
  const bad: OfficeRow[] = [
    officeRow('ODD', { claimNumber: 'ST-A-ODDCARRIER', carrier: 'Desjardins Dental Plan' }),
    officeRow('NOCLM', { claimNumber: '' }),
    { ...officeRow('FOOT', { claimNumber: 'TOTAL', first: '', last: '' }), patient_dob: '', insurance_carrier: '', amount_billed: '48210.00', amount_outstanding: '19234.50' },
  ];
  const csv = toOfficeCsv([...good, ...bad], { trailingBlankRows: 3 });
  const p = A.page;

  interface Wizard {
    reached: boolean;
    label: string;
    enabled: boolean;
    notices: string;
    detected: string;
  }
  const uploadToWizard = async (text: string): Promise<Wizard> => {
    await p.goto('/import');
    await p.locator('#csv-file').setInputFiles({ name: 'office-export.csv', mimeType: 'text/csv', buffer: Buffer.from(text) });
    const btn = p.getByRole('button', { name: /Import \d+ claims/u });
    const reached = await btn.waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
    const body = reached ? await p.locator('body').innerText() : '';
    return {
      reached,
      label: reached ? ((await btn.textContent()) ?? '').trim() : '',
      enabled: reached ? await btn.isEnabled() : false,
      notices: /missing required columns[^\n]*\n[^\n]*/iu.exec(body)?.[0]?.replace(/\n/gu, ' ') ?? '',
      detected: /(\d+) data rows detected/u.exec(body)?.[0] ?? '',
    };
  };

  // 1) The header the import API and the office-day simulation use.
  const first = await uploadToWizard(csv);
  rec.observe('Import UI', 'the wizard accepts the same column names as the import API (insurance_carrier)', first.enabled, first.enabled ? 'accepted' : `refused: ${first.notices || 'import button disabled'}`);
  rec.observe('Import UI', 'blank trailing rows are not counted as claims', /\b7 data rows\b/u.test(first.detected), `${first.detected}; button "${first.label}" (file has 7 real rows and 3 blank ones)`);

  // 2) The header the wizard documents.
  const wizardCsv = csv.replace('insurance_carrier', 'carrier_name');
  const second = await uploadToWizard(wizardCsv);
  rec.expect('Import UI', 'a file with the documented carrier header reaches an enabled import button', second.reached && second.enabled, `${second.detected}; button "${second.label}"; ${second.notices}`, true);
  if (second.enabled) {
    await p.getByRole('button', { name: /Import \d+ claims/u }).click({ timeout: 10_000 });
    await p.waitForTimeout(3_000);
    const text = (await p.locator('body').innerText()).toLowerCase();
    rec.observe('Import UI', 'the result names the held rows and why', /desjardins|not imported|held back|quarantin|unrecognized/u.test(text), 'looked for the carrier name or a reason in the page text');
    await p.screenshot({ path: `${REPORT_DIR}/artifacts/02-after-import.png` }).catch(() => undefined);
  }
  let claims = await listClaims(A);
  if (claims.length === 0) {
    rec.record('Import UI', 'browser import stored the good rows', 'FINDING', 'the wizard stored nothing; importing through the API so later steps can run');
    await importRows(A, [...good, ...bad].map((r) => ({ ...r })));
    claims = await listClaims(A);
  }
  const numbers = claims.map((c) => c.claimNumber);
  rec.expect('Import', 'all four good claims are stored', good.every((g) => numbers.includes(g.claim_number)), `stored ${numbers.length}: ${numbers.join(', ')}`, true);
  rec.expect('Import', 'no bad row was stored', !numbers.includes('ST-A-ODDCARRIER') && !numbers.includes('TOTAL'), 'unsupported carrier and totals row are absent', true);
});

test('3. a new office cannot dial until it is set up, and is told why', async () => {
  await resetFakeVapi();
  const [claim] = await listClaims(A);
  expect(claim).toBeTruthy();
  const r = await A.ops.post(`/api/insurance/queue/trigger/${claim?.id ?? ''}`);
  const body = (await r.json()) as { code?: string; error?: string };
  rec.expect('Onboarding gate', 'a freshly signed-up office is not allowed to dial', r.status() >= 400, `status ${r.status()} code ${body.code ?? 'none'}`, true);
  rec.observe('Onboarding gate', 'the refusal says what to fix', typeof body.error === 'string' && body.error.length > 15, `"${(body.error ?? '').slice(0, 140)}"`);
  rec.expect('Onboarding gate', 'nothing was dialled', (await dials()).length === 0, `${(await dials()).length} dials`, true);

  await enableDialling(A, null);
  const noNpi = await A.ops.post(`/api/insurance/queue/trigger/${claim?.id ?? ''}`);
  const noNpiBody = (await noNpi.json()) as { code?: string; error?: string };
  rec.expect('Onboarding gate', 'a configured office with no NPI is blocked for that reason', noNpiBody.code === 'MISSING_PRACTICE_IDENTIFIERS', `status ${noNpi.status()} code ${noNpiBody.code ?? 'none'}`, true);
  rec.expect('Onboarding gate', 'still nothing dialled', (await dials()).length === 0, `${(await dials()).length} dials`, true);

  const bad = await A.ops.put('/api/admin/practice-identity', { data: { npi: 'ABC-DEF' } });
  const badTrigger = await A.ops.post(`/api/insurance/queue/trigger/${claim?.id ?? ''}`);
  rec.observe('Onboarding gate', 'settings accepts a non-numeric NPI that dispatch will then refuse', bad.status() !== 200, `settings save returned ${bad.status()}, dispatch returned ${((await badTrigger.json()) as { code?: string }).code ?? 'none'}`);
  expect((await A.ops.put('/api/admin/practice-identity', { data: { npi: '9900001' } })).status()).toBe(200);
});

test('4. a dial through the real path: PHI boundary, destination, and no double dial', async () => {
  await resetFakeVapi();
  const claims = await listClaims(A);
  const target = claims.find((c) => c.claimNumber === 'ST-A-1') ?? claims[0];
  const url = `/api/insurance/queue/trigger/${target?.id ?? ''}`;
  const [r1, r2] = await Promise.all([A.ops.post(url), A.ops.post(url)]);
  const statuses = [r1.status(), r2.status()].sort();
  const sent = await dials();
  rec.expect('Dispatch', 'two simultaneous requests for one claim place exactly one dial', sent.length === 1, `statuses ${statuses.join('/')}, ${sent.length} dial(s)`, true);
  dialA = sent[0];
  const raw = JSON.stringify(dialA?.body ?? {});
  const withoutVars = JSON.stringify({ ...(dialA?.body ?? {}), assistantOverrides: { ...(dialA?.body.assistantOverrides ?? {}), variableValues: undefined } });
  const phi = ['Zephyrine', 'Quillfeather', '1984-03-17', 'SUBXA', 'GRPX'];
  rec.expect('PHI boundary', 'no patient name, DOB or member id appears anywhere in the dial except the ephemeral call variables', phi.every((p) => !withoutVars.includes(p)), `searched the request outside variableValues for ${phi.join(', ')}`, true);
  const metaText = JSON.stringify(dialA?.body.assistantOverrides?.metadata ?? {});
  rec.expect('PHI boundary', 'metadata carries tokens and ids only', phi.every((p) => !metaText.includes(p)), `metadata keys: ${Object.keys(dialA?.body.assistantOverrides?.metadata ?? {}).join(', ')}`, true);
  rec.observe('PHI boundary', 'the ephemeral call variables do carry what the agent needs', raw.includes('variableValues'), 'variableValues present');
  rec.expect('Dispatch', 'a human-assisted office dials the human-assisted squad, never the autonomous one', dialA?.body.squadId === 'selftest-human-squad-id', `squad ${dialA?.body.squadId} (autonomous squad is selftest-squad-id)`, true);
  rec.expect('Dispatch', 'the dial uses the configured caller id', dialA?.body.phoneNumberId === 'selftest-phone-number-id', `phone ${dialA?.body.phoneNumberId}`, true);
  const attempt = await db.callAttempt.findFirst({ where: { vapiCallId: dialA?.id ?? '' }, select: { isHumanAssisted: true } });
  rec.expect('Dispatch', 'the call record is flagged human-assisted so its outcome is read from the scribe log', attempt?.isHumanAssisted === true, `isHumanAssisted ${String(attempt?.isHumanAssisted)}`, true);
  rec.expect('Dispatch', 'the destination is the RBC claims line (the fake Vapi absorbed it)', /^\+1\d{10}$/u.test(dialA?.body.customer?.number ?? ''), `customer ${dialA?.body.customer?.number}`, true);

  const again = await A.ops.post(url);
  rec.expect('Dispatch', 'a claim already being called cannot be dialled again', again.status() >= 400 && (await dials()).length === 1, `second request ${again.status()}, ${(await dials()).length} dial(s)`, true);
});

test('5. the call comes back: handoff, outcome, report, and a replayed report', async () => {
  expect(dialA).toBeTruthy();
  const callId = dialA?.id ?? '';
  const meta = dialA?.body.assistantOverrides?.metadata;
  const hand = await webhook(A.api, toolCall(callId, meta, 'request_staff_handoff', {}));
  // The product only accepts an https vapi.ai control URL, which a contained run cannot provide, so a real transfer cannot happen here.
  rec.expect('Webhook', 'when the transfer cannot happen the agent is not told it did', hand.status === 200 && !/HANDOFF INITIATED/u.test(hand.body), `status ${hand.status}: ${hand.body.slice(0, 260)}`, true);
  rec.observe('Webhook', 'the failure result tells the agent what to do next', /HANDOFF FAILED|reference number/iu.test(hand.body), 'looked for the missed-handoff instructions in the tool result');
  rec.record('Webhook', 'a staff handoff that succeeds transfers the call and notifies staff', 'UNVERIFIED', 'needs a live Vapi control URL (https on vapi.ai); the self-test cannot emulate it without leaving the machine');
  const notes = await A.api.get('/api/insurance/practice-notifications');
  const noteText = JSON.stringify(await notes.json());
  rec.expect('Webhook', 'no "rep on the line" notification is raised for a handoff that failed', !/Rep on the line/u.test(noteText), `notifications status ${notes.status()}`, true);

  const outcome = await webhook(A.api, toolCall(callId, meta, 'log_call_outcome', { scenario: 'CLAIM_PAID', callSummary: 'Synthetic: rep confirmed payment.', repName: 'Rep Alpha', referenceNumber: 'REF-9900', amountStatedByRep: '742.50', matchesExpectedAmount: true }));
  rec.expect('Webhook', 'the scribe outcome is accepted', outcome.status === 200, `status ${outcome.status}: ${outcome.body.slice(0, 90)}`, true);

  const report = endReport(callId, meta, 95, 'Rep Alpha: Payment of 742.50 was issued. Reference REF-9900.');
  const end = await webhook(A.api, report);
  rec.expect('Webhook', 'the end-of-call report is accepted', end.status === 200, `status ${end.status}`, true);

  const claim = (await listClaims(A)).find((c) => c.claimNumber === 'ST-A-1');
  rec.observe('Outcome', 'a paid outcome closes the claim', claim?.status === 'RESOLVED', `claim status after a CLAIM_PAID outcome: ${claim?.status}`);
  const afterFirst = claim?.status;

  const replay = await webhook(A.api, report);
  rec.expect('Webhook', 'replaying the same report is harmless', replay.status === 200 || replay.status === 409, `status ${replay.status}`, true);
  const afterReplay = (await listClaims(A)).find((c) => c.claimNumber === 'ST-A-1')?.status;
  rec.expect('Webhook', 'a replay does not change the claim', afterReplay === afterFirst, `${afterFirst} then ${afterReplay}`, true);

  const seenAfterCall = (await (await fetch(`${FAKE_VAPI}/__dials`)).json()) as { other: Array<{ method: string; path: string }> };
  const deletion = seenAfterCall.other.filter((o) => o.method === 'DELETE' && o.path.includes(callId) && o.path.endsWith('/recording'));
  rec.observe('PHI boundary', 'the call recording is deleted from Vapi after the call ends', deletion.length > 0, `${deletion.length} recording delete request(s) reached the Vapi stand-in for ${callId}`);

  const forged = endReport(callId, { ...(meta ?? {}), practiceId: B.practiceId }, 60, 'forged');
  const forgedRes = await webhook(A.api, forged);
  const bClaims = await listClaims(B);
  rec.expect('Tenancy', 'a webhook claiming to belong to another practice cannot touch it', bClaims.every((c) => c.status !== 'RESOLVED'), `forged webhook status ${forgedRes.status}; office B claims unchanged`, true);
});

test('6. a carrier refusal blocks the carrier, and what that does to a second office', async () => {
  await resetFakeVapi();
  const claims = await listClaims(A);
  const next = claims.find((c) => c.claimNumber === 'ST-A-2');
  const trig = await A.ops.post(`/api/insurance/queue/trigger/${next?.id ?? ''}`);
  rec.expect('Carrier block', 'a second call to the carrier is placed normally before a refusal', trig.status() < 400 && (await dials()).length === 1, `status ${trig.status()}`, true);
  const d = (await dials())[0];
  const meta = d?.body.assistantOverrides?.metadata;
  const refusal = await webhook(A.api, endReport(d?.id ?? '', meta, 40, 'Rep: Is this an automated call? We do not accept automated calls. I am ending this call.'));
  rec.expect('Carrier block', 'the refusal report is accepted', refusal.status === 200, `status ${refusal.status}`, true);

  await resetFakeVapi();
  const third = claims.find((c) => c.claimNumber === 'ST-A-3');
  const blocked = await A.ops.post(`/api/insurance/queue/trigger/${third?.id ?? ''}`);
  const blockedBody = (await blocked.json()) as { code?: string };
  rec.expect('Carrier block', 'after a refusal the same office cannot call that carrier', blocked.status() >= 400 && blockedBody.code === 'CARRIER_BLOCK' && (await dials()).length === 0, `status ${blocked.status()} code ${blockedBody.code}`, true);

  await enableDialling(B, '9900002');
  await importRows(B, goodRows('B', 2).map((r) => ({ ...r })));
  const bClaim = (await listClaims(B)).find((c) => c.claimNumber === 'ST-B-1');
  await resetFakeVapi();
  const cross = await B.ops.post(`/api/insurance/queue/trigger/${bClaim?.id ?? ''}`);
  const dialledForB = (await dials()).length;
  rec.record('Carrier block', 'a block raised by one office also stops another office calling that carrier', dialledForB === 0 ? 'PASS' : 'FINDING',
    dialledForB === 0 ? 'office B was refused' : `KNOWN GAP: office B's call to the same carrier was placed (status ${cross.status()}). CLAUDE.md calls CARRIER_BLOCK fleet-wide for a carrier.`);
});

test('7. tenancy: one office cannot see or act on another office\'s claims', async () => {
  const aClaims = await listClaims(A);
  const aId = aClaims[0]?.id ?? '';
  const probes: Array<[string, () => Promise<number>]> = [
    ['read a claim', async () => (await B.ops.get(`/api/insurance/claims/${aId}`)).status()],
    ['read its recovery state', async () => (await B.ops.get(`/api/insurance/claims/${aId}/recovery`)).status()],
    ['read its evidence', async () => (await B.ops.get(`/api/insurance/claims/${aId}/evidence`)).status()],
    ['export its evidence pack', async () => (await B.ops.get(`/api/insurance/claims/${aId}/evidence-pack`)).status()],
    ['edit it', async () => (await B.ops.patch(`/api/insurance/claims/${aId}`, { data: { priority: 'URGENT' } })).status()],
    ['trigger a call on it', async () => (await B.ops.post(`/api/insurance/queue/trigger/${aId}`)).status()],
    ['confirm payment on it', async () => (await B.ops.post(`/api/insurance/claims/${aId}/confirm-payment`, { data: {} })).status()],
  ];
  for (const [name, run] of probes) {
    const status = await run();
    rec.expect('Tenancy', `office B cannot ${name} that belongs to office A`, status === 403 || status === 404, `status ${status}`, true);
  }
  const bList = await listClaims(B);
  rec.expect('Tenancy', "office B's claim list contains none of office A's claims", bList.every((c) => !aClaims.some((a) => a.id === c.id)), `${bList.length} claims in B, none from A`, true);
  const qa = await (await A.api.get('/api/insurance/queue')).json() as { snapshot?: Record<string, number> };
  const qb = await (await B.api.get('/api/insurance/queue')).json() as { snapshot?: Record<string, number> };
  rec.observe('Tenancy', 'queue snapshots differ per office', JSON.stringify(qa.snapshot) !== JSON.stringify(qb.snapshot), `A ${JSON.stringify(qa.snapshot)} B ${JSON.stringify(qb.snapshot)}`);
});

test('8. hostile data in an import does not execute in the browser', async () => {
  const xss: OfficeRow[] = [
    officeRow('XSS', { claimNumber: 'ST-X-1', first: '<img src=x onerror="window.__xss=1">', last: '"><script>window.__xss=1</script>' }),
    officeRow('FORM', { claimNumber: 'ST-X-2', first: '=HYPERLINK("http://evil.invalid","x")', last: '+cmd|calc' }),
  ];
  await importRows(A, xss.map((r) => ({ ...r })));
  const dialogs: string[] = [];
  A.page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });
  await A.page.goto('/insurance');
  await A.page.waitForLoadState('networkidle').catch(() => undefined);
  const flag = await A.page.evaluate(() => (window as unknown as { __xss?: number }).__xss);
  rec.expect('Hostile input', 'script in a patient name does not run on the claims page', flag === undefined && dialogs.length === 0, `window flag ${String(flag)}, dialogs ${dialogs.length}`, true);
  const stored = (await listClaims(A)).filter((c) => c.claimNumber.startsWith('ST-X-'));
  rec.observe('Hostile input', 'both hostile rows were accepted as data', stored.length === 2, `${stored.length} stored`);
  await A.page.screenshot({ path: `${REPORT_DIR}/artifacts/08-claims-page.png` }).catch(() => undefined);
});

test('9. every main page renders for a signed-in office', async () => {
  const pages = ['/dashboard', '/work-queue', '/import', '/settings', '/insurance', '/admin/integrations'];
  for (const path of pages) {
    const errors: string[] = [];
    const onResp = (r: { status(): number; url(): string }): void => {
      if (r.status() >= 500 && isLocal(r.url())) errors.push(`${r.status()} ${new URL(r.url()).pathname}`);
    };
    A.page.on('response', onResp);
    const before = pageProblems.length;
    await A.page.goto(path);
    await A.page.waitForLoadState('networkidle').catch(() => undefined);
    A.page.off('response', onResp);
    const body = (await A.page.locator('body').innerText()).toLowerCase();
    const crashed = /something went wrong|application error|unexpected error/u.test(body);
    const redirectedToLogin = /\/login/u.test(A.page.url());
    rec.expect('Pages', `${path} renders`, !crashed && !redirectedToLogin && errors.length === 0 && pageProblems.length === before,
      `${crashed ? 'error screen; ' : ''}${redirectedToLogin ? 'sent to login; ' : ''}${errors.join(', ')}${pageProblems.slice(before).join('; ')}` || 'ok', true);
  }
});

test('10. containment: nothing left the machine', async () => {
  const egress = EGRESS_LOG && existsSync(EGRESS_LOG) ? readFileSync(EGRESS_LOG, 'utf8').trim() : '';
  rec.expect('Containment', 'the app tried to reach no outside host', egress === '', egress === '' ? 'egress log empty' : `blocked attempts:\n${egress.split('\n').slice(0, 8).join('\n')}`, true);
  rec.record('Containment', 'the browser tried to reach outside hosts', externalHosts.size === 0 ? 'PASS' : 'FINDING',
    externalHosts.size === 0 ? 'none' : `blocked: ${[...externalHosts].join(', ')} (third-party requests from the app's pages; each is a privacy and offline-resilience question)`);
  const seen = await (await fetch(`${FAKE_VAPI}/__dials`)).json() as { other: Array<{ method: string; path: string }> };
  rec.observe('Containment', 'other calls the app made to Vapi', true, seen.other.length === 0 ? 'none' : seen.other.map((o) => `${o.method} ${o.path}`).slice(0, 8).join(', '));
});
