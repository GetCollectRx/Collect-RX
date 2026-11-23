/**
 * Whole-application crawl: every route, as every role it can reach, plus the
 * routes each role should NOT reach, plus an anonymous probe of every static API
 * path the frontend calls. Output is a feature scorecard (CRAWL-REPORT.md).
 *
 * Contained exactly like the self-test: the app has no outside network, the
 * browser cannot resolve outside hosts, Vapi is a local fake, data is synthetic.
 *
 * Classification, per route and role:
 *   BROKEN  an uncaught error, a 5xx response, a crash screen, or a blank page
 *   PARTLY  console errors, failed API calls (4xx), a stuck spinner, or an error banner
 *   WORKS   renders with content and none of the above
 * A role that should be refused is DENIED when it is, and LEAKS when the page renders anyway.
 */
import { createHmac } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { officeRow, type OfficeRow } from '../tests/sim-harness/officeFixtures';

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.SELFTEST_BASE_URL ?? 'http://127.0.0.1:3120';
const FAKE_VAPI = process.env.FAKE_VAPI_URL ?? 'http://127.0.0.1:3199';
const WEBHOOK_SECRET = process.env.SELFTEST_WEBHOOK_SECRET ?? '';
const REPORT_DIR = process.env.SELFTEST_REPORT_DIR ?? 'self-test/report';
const PASSWORD = 'Selftest-Pass-12345!';
const db = new PrismaClient({ datasources: { db: { url: process.env.SELFTEST_DB_URL ?? '' } } });

type Verdict = 'WORKS' | 'PARTLY' | 'BROKEN' | 'DENIED' | 'LEAKS' | 'UNTESTED';

interface RouteDef {
  path: string;
  component: string;
  /** Personas the router allows; null means no role gate; 'group' means the group-admin rule. */
  roles: string[] | 'group' | null;
}

interface Visit {
  route: string;
  role: string;
  expected: 'allowed' | 'refused';
  verdict: Verdict;
  notes: string[];
  heading: string;
  finalPath: string;
  ms: number;
}

const visits: Visit[] = [];
const CSP_ERROR = /Executing inline event handler violates the following Content Security Policy/u;
let cspBlockedPages = 0;
const referenceHeading = new Map<string, string>();

// ── Route inventory, read from the router so it cannot drift ─────────────────
function readRoutes(): RouteDef[] {
  const source = readFileSync(path.resolve(here, '../src/App.tsx'), 'utf8');
  const seen = new Set<string>();
  const out: RouteDef[] = [];
  for (const line of source.split('\n')) {
    const m = /<Route\s+path="([^"]+)"\s+element=\{(.*)\}\s*\/>/u.exec(line);
    if (!m) continue;
    const [, routePath, element] = m;
    if (!routePath || !element || routePath === '*' || routePath.endsWith('/*') || element.includes('<Navigate') || seen.has(routePath)) continue;
    const components = [...element.matchAll(/<([A-Z]\w+)\s*\/>/gu)].map((c) => c[1] ?? '').filter((c) => c !== 'ProtectedRoute' && c !== 'GroupAdminRoute');
    const rolesMatch = /allowedRoles=\{\[([^\]]*)\]\}/u.exec(element);
    seen.add(routePath);
    out.push({
      path: routePath,
      component: components[components.length - 1] ?? 'unknown',
      roles: element.includes('<GroupAdminRoute>') ? 'group' : rolesMatch ? [...(rolesMatch[1] ?? '').matchAll(/'([^']+)'/gu)].map((r) => r[1] ?? '') : null,
    });
  }
  return out;
}

// ── Static API paths the frontend calls, for the anonymous exposure probe ────
function staticApiPaths(): string[] {
  const root = path.resolve(here, '../src');
  const found = new Set<string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        if (!/node_modules|__tests__/u.test(full)) walk(full);
      } else if (/\.tsx?$/u.test(name) && !/\.test\./u.test(name)) {
        for (const m of readFileSync(full, 'utf8').matchAll(/['"`](\/api\/[A-Za-z0-9_\-/]+)['"`?]/gu)) {
          const p = m[1] ?? '';
          if (p && !p.endsWith('/')) found.add(p);
        }
      }
    }
  };
  walk(root);
  return [...found].sort();
}

// ── Setup helpers ────────────────────────────────────────────────────────────
async function inviteAndAccept(browser: Browser, ownerApi: APIRequestContext, rawRole: string, tag: string): Promise<{ context: BrowserContext; note: string } | null> {
  const email = `${rawRole}-${tag}@selftest.invalid`;
  const invite = await ownerApi.post('/api/auth/invite', { data: { email, role: rawRole } });
  if (invite.status() !== 200) return null;
  const body = (await invite.json()) as { token?: string };
  const token = body.token ?? (await db.inviteToken.findFirst({ where: { email }, orderBy: { createdAt: 'desc' }, select: { token: true } }))?.token;
  const context = await browser.newContext({ baseURL: BASE });
  const accepted = await context.request.post('/api/auth/accept-invite', { data: { token, displayName: `Selftest ${rawRole}`, password: PASSWORD } });
  if (accepted.status() !== 201) {
    await context.close();
    return null;
  }
  return { context, note: 'invited and accepted' };
}

const sign = (envelope: Record<string, unknown>): { raw: string; headers: Record<string, string> } => {
  const raw = JSON.stringify(envelope);
  return { raw, headers: { 'content-type': 'application/json', 'x-vapi-signature': `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex')}` } };
};

async function seedOffice(manager: APIRequestContext): Promise<{ claimId: string }> {
  const carriers = ['canada_life', 'manulife', 'green_shield', 'rbc', 'sun_life', 'telus_adjudicare'] as const;
  await manager.put('/api/admin/settings', {
    data: { settings: { voiceAgentEnabled: true, humanAssistedMode: true, escalationPhoneNumber: '+16135550102', carrierConfigs: carriers.map((carrierId) => ({ carrierId, enabled: true, authorizationSubmitted: true, authorizationSubmittedAt: new Date().toISOString(), providerNumber: '9900100' })) } },
  });
  await manager.put('/api/admin/practice-identity', { data: { billingPhone: '+16135550101', practiceAddress: '1 Synthetic Way, Ottawa ON', npi: '9900001', taxId: '9900002' } });
  const rows: OfficeRow[] = [
    ...['RBC Insurance', 'Sun Life', 'Manulife', 'Green Shield'].flatMap((carrier, i) => [officeRow('CRAWL', { claimNumber: `CR-${i}-A`, carrier }), officeRow('CRAWL', { claimNumber: `CR-${i}-B`, carrier, days: 60 })]),
    officeRow('OLD', { claimNumber: 'CR-OLD', carrier: 'Sun Life', days: 120 }),
    officeRow('BIG', { claimNumber: 'CR-BIG', carrier: 'Canada Life', outstanding: '9800.00', billed: '9800.00' }),
  ];
  const imp = await manager.post('/api/insurance/claims/import', { data: { records: rows.map((r) => ({ ...r })) } });
  expect(imp.status(), 'seed import').toBe(200);
  const claims = ((await (await manager.get('/api/insurance/claims?limit=100')).json()) as { data: Array<{ id: string; claimNumber: string }> }).data;
  const byNumber = (n: string): string => claims.find((c) => c.claimNumber === n)?.id ?? '';
  // One paid call and one refusal, so call history, carrier stats and blocked claims have content.
  for (const [claimNumber, transcript, outcome] of [['CR-0-A', 'Rep: Payment of 742.50 was issued. Ref REF-1.', true], ['CR-1-A', 'Rep: Is this an automated call? We do not accept automated calls. I am ending this call.', false]] as const) {
    await fetch(`${FAKE_VAPI}/__reset`);
    const trig = await manager.post(`/api/insurance/queue/trigger/${byNumber(claimNumber)}`);
    if (trig.status() >= 400) continue;
    const dial = ((await (await fetch(`${FAKE_VAPI}/__dials`)).json()) as { dials: Array<{ id: string; body: { assistantOverrides?: { metadata?: Record<string, unknown> } } }> }).dials[0];
    if (!dial) continue;
    const meta = dial.body.assistantOverrides?.metadata;
    if (outcome) {
      const s = sign({ message: { type: 'tool-calls', call: { id: dial.id, assistantOverrides: { metadata: meta } }, toolWithToolCallList: [{ name: 'log_call_outcome', toolCall: { id: 'tc1', function: { name: 'log_call_outcome', arguments: JSON.stringify({ scenario: 'CLAIM_PAID', callSummary: 'Synthetic paid.', repName: 'Rep Alpha', referenceNumber: 'REF-1', amountStatedByRep: '742.50', matchesExpectedAmount: true }) } } }] } });
      await manager.post('/api/webhooks/vapi', { data: s.raw, headers: s.headers });
    }
    const end = new Date();
    const s = sign({ message: { type: 'end-of-call-report', startedAt: new Date(end.getTime() - 90_000).toISOString(), endedAt: end.toISOString(), endedReason: 'customer-ended-call', call: { id: dial.id, assistantOverrides: { metadata: meta } }, artifact: { transcript }, analysis: { summary: 'Synthetic.' }, cost: 0.05 } });
    await manager.post('/api/webhooks/vapi', { data: s.raw, headers: s.headers });
  }
  return { claimId: byNumber('CR-2-B') || byNumber('CR-0-B') };
}

// ── One page visit ───────────────────────────────────────────────────────────
const isLocal = (url: string): boolean => /^(https?:\/\/(127\.0\.0\.1|localhost)[:/]|data:|blob:|about:)/u.test(url);
const CRASH = /something went wrong|application error|unexpected error|minified react error|cannot read propert/iu;
const ERROR_BANNER = /failed to load|could not load|couldn't load|error loading|unable to load|failed to fetch|request failed/iu;

async function visit(page: Page, route: string, role: string, expected: Visit['expected'], shotDir: string): Promise<Visit> {
  const notes: string[] = [];
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failures: string[] = [];
  const serverErrors: string[] = [];
  let cspBlocked = false;
  const onError = (e: Error): void => void pageErrors.push(e.message.slice(0, 140));
  const onConsole = (m: { type(): string; text(): string; location(): { url: string } }): void => {
    if (m.type() !== 'error' || !isLocal(m.location().url || BASE)) return;
    // A 401 for a visitor with no session is the app asking "am I signed in?", not a fault.
    if (/status of 401/u.test(m.text())) return;
    if (CSP_ERROR.test(m.text())) cspBlocked = true;
    else consoleErrors.push(m.text().slice(0, 140));
  };
  const onResponse = (r: { status(): number; url(): string; request(): { method(): string } }): void => {
    if (!isLocal(r.url())) return;
    const p = new URL(r.url()).pathname;
    if (r.status() >= 500) serverErrors.push(`${r.request().method()} ${p} ${r.status()}`);
    else if (r.status() >= 400 && p.startsWith('/api/') && r.status() !== 401) failures.push(`${r.request().method()} ${p} ${r.status()}`);
  };
  page.on('pageerror', onError);
  page.on('console', onConsole);
  page.on('response', onResponse);
  const started = Date.now();
  let verdict: Verdict = 'WORKS';
  let heading = '';
  let finalPath = route;
  try {
    await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => notes.push('network never went idle'));
    await page.waitForTimeout(800);
    finalPath = new URL(page.url()).pathname + new URL(page.url()).search;
    const body = await page.locator('body').innerText().catch(() => '');
    heading = ((await page.locator('h1').first().textContent({ timeout: 1_000 }).catch(() => '')) ?? '').trim().slice(0, 80);
    const spinner = await page.locator('[role="progressbar"], [aria-busy="true"], .animate-spin').first().isVisible().catch(() => false);
    if (expected === 'allowed') {
      if (pageErrors.length > 0) { verdict = 'BROKEN'; notes.push(`uncaught: ${pageErrors[0]}`); }
      else if (serverErrors.length > 0) { verdict = 'BROKEN'; notes.push(`server error: ${serverErrors.slice(0, 2).join(', ')}`); }
      else if (CRASH.test(body)) { verdict = 'BROKEN'; notes.push('crash screen'); }
      else if (body.trim().length < 40) { verdict = 'BROKEN'; notes.push('blank page'); }
      else {
        if (consoleErrors.length > 0) { verdict = 'PARTLY'; notes.push(`console: ${consoleErrors[0]}`); }
        if (failures.length > 0) { verdict = 'PARTLY'; notes.push(`failed calls: ${[...new Set(failures)].slice(0, 3).join(', ')}`); }
        if (spinner) { verdict = 'PARTLY'; notes.push('spinner still showing after load'); }
        if (ERROR_BANNER.test(body)) { verdict = 'PARTLY'; notes.push('page shows an error message'); }
      }
    } else {
      const ref = referenceHeading.get(route.split('?')[0] ?? route);
      const sameAsAllowed = ref !== undefined && ref !== '' && heading === ref;
      const rendered = body.trim().length > 40 && !CRASH.test(body);
      verdict = sameAsAllowed || (ref === undefined && rendered && !/\/login/u.test(finalPath) && finalPath.split('?')[0] === route.split('?')[0]) ? 'LEAKS' : 'DENIED';
      if (verdict === 'LEAKS') notes.push(`rendered "${heading || 'content'}" for a role the router refuses`);
    }
    if (expected === 'allowed' && verdict !== 'BROKEN') referenceHeading.set(route.split('?')[0] ?? route, heading);
    const slug = route.replace(/[^a-z0-9]+/giu, '_').replace(/^_|_$/gu, '') || 'home';
    await page.screenshot({ path: path.join(shotDir, `${slug}.png`) }).catch(() => undefined);
  } catch (e) {
    verdict = expected === 'allowed' ? 'BROKEN' : 'DENIED';
    notes.push(`navigation failed: ${(e as Error).message.slice(0, 100)}`);
  } finally {
    page.off('pageerror', onError);
    page.off('console', onConsole);
    page.off('response', onResponse);
  }
  if (cspBlocked) cspBlockedPages += 1;
  return { route, role, expected, verdict, notes, heading, finalPath, ms: Date.now() - started };
}

// ── The crawl ────────────────────────────────────────────────────────────────
interface Session {
  label: string;
  persona: string;
  context: BrowserContext | null;
  note: string;
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(45 * 60_000);

const sessions: Session[] = [];
const apiProbe: Array<{ path: string; status: number }> = [];
let routes: RouteDef[] = [];
let sampleClaimId = '';

test('crawl: set up every role with realistic data', async ({ browser }) => {
  routes = readRoutes();
  const owner = await browser.newContext({ baseURL: BASE });
  const tag = `${Date.now()}`;
  const reg = await owner.request.post('/api/auth/register', { data: { practiceName: 'SELFTEST Crawl Office', displayName: 'Owner Crawl', email: `owner-${tag}@selftest.invalid`, password: PASSWORD } });
  expect(reg.status()).toBe(201);
  sessions.push({ label: 'owner', persona: '', context: owner, note: 'signup' });

  const manager = await inviteAndAccept(browser, owner.request, 'office_manager', tag);
  expect(manager, 'office manager can be invited').toBeTruthy();
  const seeded = await seedOffice(manager?.context.request as APIRequestContext);
  sampleClaimId = seeded.claimId;
  sessions.push({ label: 'office_manager', persona: '', context: manager?.context ?? null, note: 'invited' });

  for (const raw of ['billing_coordinator', 'front_desk', 'accountant', 'auditor']) {
    const s = await inviteAndAccept(browser, owner.request, raw, tag);
    sessions.push({ label: raw, persona: '', context: s?.context ?? null, note: s ? 'invited' : 'could not be created through the invite API' });
  }
  // A group admin signs up as a dental group, which is how that persona exists in the product.
  const group = await browser.newContext({ baseURL: BASE });
  const g = await group.request.post('/api/auth/register', { data: { practiceName: 'SELFTEST Group HQ', displayName: 'Group Admin', email: `group-${tag}@selftest.invalid`, password: PASSWORD, organizationName: 'SELFTEST Dental Group', additionalPractices: [{ practiceName: 'SELFTEST Group Site 2' }] } });
  sessions.push({ label: 'group_admin', persona: '', context: g.status() === 201 ? group : null, note: g.status() === 201 ? 'organization signup' : `signup returned ${g.status()}` });
  sessions.push({ label: 'anonymous', persona: 'anonymous', context: await browser.newContext({ baseURL: BASE }), note: 'no login' });
  sessions.push({ label: 'platform_admin', persona: '', context: null, note: 'a platform user cannot be created through the product; untested' });

  for (const s of sessions) {
    if (!s.context || s.label === 'anonymous') continue;
    const me = (await (await s.context.request.get('/api/auth/me')).json()) as { userRole?: string };
    s.persona = me.userRole ?? 'unknown';
  }
});

test('crawl: every route, as every role', async () => {
  const shotRoot = `${REPORT_DIR}/crawl`;
  const allowed = (r: RouteDef, persona: string, label: string): boolean =>
    // The router lists some raw role names (accountant) next to persona names, so a session matches on either.
    r.roles === null ? true : label === 'anonymous' ? false : r.roles === 'group' ? label === 'group_admin' : r.roles.includes(persona) || r.roles.includes(label);

  for (const s of sessions) {
    if (!s.context) continue;
    const dir = `${shotRoot}/${s.label}`;
    mkdirSync(dir, { recursive: true });
    const page = await s.context.newPage();
    for (const r of routes) {
      const concrete = r.path.includes(':') ? (r.path.startsWith('/insurance/') ? `/insurance/${sampleClaimId}` : null) : r.path;
      if (!concrete) continue;
      const should = allowed(r, s.persona, s.label);
      const v = await visit(page, concrete, s.label, should ? 'allowed' : 'refused', dir);
      visits.push(v);
    }
    await page.close();
  }
});

test('crawl: click every safe button on every page the office manager can reach', async () => {
  const manager = sessions.find((s) => s.label === 'office_manager');
  expect(manager?.context).toBeTruthy();
  const page = await (manager?.context as BrowserContext).newPage();
  page.on('dialog', (d) => void d.dismiss().catch(() => undefined));
  // Anything that ends a session, deletes, spends money or places a call is left alone.
  const RISKY = /delete|remove|sign out|log out|logout|cancel|unlink|disconnect|revoke|purge|erase|reset|wipe|download|export|dial|call now|trigger|upgrade|subscribe|pay|checkout|invite|deactivate|break.?glass/iu;
  const pages = routes.filter((r) => !r.path.includes(':') && Array.isArray(r.roles) && r.roles.includes('practice_owner'));
  for (const r of pages) {
    await page.goto(r.path, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
    const labels = await page.locator('button:visible').evaluateAll((els) =>
      els.map((e) => ((e.getAttribute('aria-label') ?? e.textContent ?? '').replace(/\s+/gu, ' ').trim())).filter((t, i, all) => t !== '' && all.indexOf(t) === i));
    for (const label of labels.filter((l) => !RISKY.test(l)).slice(0, 10)) {
      await page.goto(r.path, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
      const target = page.locator('button:visible').filter({ hasText: label }).first();
      const alt = page.locator(`button[aria-label="${label.replace(/"/gu, '\\"')}"]:visible`).first();
      const button = (await target.count()) > 0 ? target : alt;
      const notes: string[] = [];
      let requests = 0;
      const onErr = (e: Error): void => void notes.push(`uncaught: ${e.message.slice(0, 90)}`);
      const onReq = (q: { url(): string }): void => { if (isLocal(q.url()) && q.url().includes('/api/')) requests += 1; };
      const onResp = (q: { status(): number; url(): string }): void => { if (isLocal(q.url()) && q.status() >= 500) notes.push(`server error ${q.status()} ${new URL(q.url()).pathname}`); };
      page.on('pageerror', onErr);
      page.on('request', onReq);
      page.on('response', onResp);
      const beforeUrl = page.url();
      const beforeText = await page.locator('body').innerText().catch(() => '');
      let clicked = true;
      await button.click({ timeout: 3_000 }).catch(() => { clicked = false; });
      await page.waitForTimeout(700);
      const afterText = await page.locator('body').innerText().catch(() => '');
      page.off('pageerror', onErr);
      page.off('request', onReq);
      page.off('response', onResp);
      if (!clicked) { notes.push('could not be clicked'); }
      if (CRASH.test(afterText) && !CRASH.test(beforeText)) notes.push('crash screen after click');
      const changed = page.url() !== beforeUrl || afterText !== beforeText || requests > 0;
      const broken = notes.some((n) => !n.startsWith('could not'));
      visits.push({
        route: `${r.path} [button: ${label.slice(0, 40)}]`,
        role: 'office_manager',
        expected: 'allowed',
        verdict: broken ? 'BROKEN' : !clicked || !changed ? 'PARTLY' : 'WORKS',
        notes: broken ? notes : !clicked ? notes : !changed ? ['no visible effect: no navigation, no page change, no API call'] : [],
        heading: label,
        finalPath: page.url(),
        ms: 0,
      });
    }
  }
  await page.close();
});

test('crawl: anonymous probe of every static API path the frontend calls', async ({ playwright }) => {
  const anon = await playwright.request.newContext({ baseURL: BASE });
  for (const p of staticApiPaths()) {
    const r = await anon.get(p).catch(() => null);
    apiProbe.push({ path: p, status: r?.status() ?? 0 });
  }
  await anon.dispose();
});

test.afterAll(async () => {
  for (const s of sessions) await s.context?.close().catch(() => undefined);
  await db.$disconnect().catch(() => undefined);
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(`${REPORT_DIR}/crawl-results.json`, JSON.stringify({ sessions: sessions.map((s) => ({ label: s.label, persona: s.persona, note: s.note })), visits, apiProbe }, null, 2));

  const roleCols = sessions.filter((s) => s.context).map((s) => s.label);
  const cell = (route: string, role: string): string => {
    const v = visits.find((x) => x.route === route && x.role === role);
    return v ? v.verdict : '';
  };
  const lines: string[] = ['# CollectRx application crawl report', '', `Generated ${new Date().toISOString()}. Synthetic data, contained run.`, ''];
  const allowedVisits = visits.filter((v) => v.expected === 'allowed' && !v.route.includes('[button:'));
  const clicks = visits.filter((v) => v.route.includes('[button:'));
  const count = (verdict: Verdict, list: Visit[]): number => list.filter((v) => v.verdict === verdict).length;
  lines.push(`Page visits as an allowed role: **${allowedVisits.length}**. WORKS ${count('WORKS', allowedVisits)}, PARTLY ${count('PARTLY', allowedVisits)}, BROKEN ${count('BROKEN', allowedVisits)}.`);
  lines.push(`Button clicks on pages the office manager can reach: **${clicks.length}**. WORKS ${count('WORKS', clicks)} (something visibly happened), PARTLY ${count('PARTLY', clicks)} (no visible effect or could not be clicked), BROKEN ${count('BROKEN', clicks)} (an error or crash).`);
  lines.push(`Pages where the browser blocked an inline event handler under the app's own security policy: **${cspBlockedPages}** (counted once here, not per page).`);
  lines.push(`Visits as a role the router refuses: **${visits.filter((v) => v.expected === 'refused').length}**. DENIED ${count('DENIED', visits)}, LEAKS ${count('LEAKS', visits)}.`, '');
  lines.push('## Roles used', '', '| Role | Persona the app assigned | How it was created |', '|---|---|---|');
  for (const s of sessions) lines.push(`| ${s.label} | ${s.persona || 'none'} | ${s.note} |`);
  lines.push('', '## Scorecard (rows are routes, columns are roles)', '', `| Route | Component | ${roleCols.join(' | ')} |`, `|---|---|${roleCols.map(() => '---').join('|')}|`);
  for (const r of routes) {
    const concrete = r.path.includes(':') ? (r.path.startsWith('/insurance/') ? `/insurance/${sampleClaimId}` : null) : r.path;
    if (!concrete) { lines.push(`| ${r.path} | ${r.component} | ${roleCols.map(() => 'UNTESTED').join(' | ')} |`); continue; }
    lines.push(`| ${r.path} | ${r.component} | ${roleCols.map((c) => cell(concrete, c) || '-').join(' | ')} |`);
  }
  const bad = visits.filter((v) => v.verdict === 'BROKEN' || v.verdict === 'PARTLY' || v.verdict === 'LEAKS');
  lines.push('', '## Every problem found', '', '| Verdict | Role | Route | Evidence |', '|---|---|---|---|');
  for (const v of bad) lines.push(`| ${v.verdict} | ${v.role} | ${v.route} | ${v.notes.join('; ').replace(/\|/gu, '/') || '-'} |`);
  const publicApi = apiProbe.filter((p) => p.status === 200);
  const crashing = apiProbe.filter((p) => p.status >= 500);
  lines.push('', '## Anonymous API probe', '', `${apiProbe.length} static API paths from the frontend, requested with no login. Refused (401 or 403): ${apiProbe.filter((p) => p.status === 401 || p.status === 403).length}. Answered 200 without a login: ${publicApi.length}. Server error: ${crashing.length}. Other: ${apiProbe.length - publicApi.length - crashing.length - apiProbe.filter((p) => p.status === 401 || p.status === 403).length}.`, '');
  if (publicApi.length > 0) lines.push('Answered 200 with no login (check each is meant to be public):', '', ...publicApi.map((p) => `- \`${p.path}\``), '');
  if (crashing.length > 0) lines.push('Server error with no login:', '', ...crashing.map((p) => `- \`${p.path}\` ${p.status}`), '');
  writeFileSync(`${REPORT_DIR}/CRAWL-REPORT.md`, `${lines.join('\n')}\n`);
});
