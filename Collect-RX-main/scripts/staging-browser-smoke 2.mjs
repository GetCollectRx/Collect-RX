/**
 * Group C — authenticated product-path smoke against a staging host.
 * Usage:
 *   STAGING_API_BASE=https://collect-rx-staging.fly.dev \
 *   STAGING_EMAIL=… STAGING_PASSWORD=… \
 *   node scripts/staging-browser-smoke.mjs
 *
 * Or load Collect-RX-main/.staging-seed-credentials (KEY=value lines).
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const credPath = join(root, '.staging-seed-credentials');

function loadCredFile() {
  if (!existsSync(credPath)) return {};
  const out = {};
  for (const line of readFileSync(credPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const fileCreds = loadCredFile();
const base = (
  process.env.STAGING_API_BASE ||
  fileCreds.STAGING_URL ||
  'https://collect-rx-staging.fly.dev'
).replace(/\/$/, '');
const email = process.env.STAGING_EMAIL || fileCreds.SEED_PRACTICE_EMAIL;
const password = process.env.STAGING_PASSWORD || fileCreds.SEED_PRACTICE_PASSWORD;

if (!email || !password) {
  console.error('Missing STAGING_EMAIL / STAGING_PASSWORD (or .staging-seed-credentials)');
  process.exit(1);
}

let fail = 0;
function ok(label, detail = '') {
  console.log(`OK  ${label}${detail ? `  ${detail}` : ''}`);
}
function bad(label, detail = '') {
  console.error(`FAIL ${label}${detail ? `  ${detail}` : ''}`);
  fail = 1;
}

async function fetchText(path, init = {}) {
  const res = await fetch(`${base}${path}`, {
    redirect: 'manual',
    ...init,
    headers: {
      Accept: 'text/html,application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  return { res, text };
}

async function main() {
  console.log(`CollectRx staging browser/API smoke → ${base}`);
  console.log(`Login as ${email}\n`);

  // Public SPA shells
  for (const path of ['/login', '/billing', '/insurance', '/import', '/admin/integrations']) {
    const { res, text } = await fetchText(path);
    if (res.status !== 200) {
      bad(`GET ${path}`, `status ${res.status}`);
      continue;
    }
    if (!/<html|<!DOCTYPE/i.test(text) && !/root|CollectRx/i.test(text)) {
      bad(`GET ${path}`, 'unexpected body (not SPA HTML)');
      continue;
    }
    ok(`GET ${path}`, `SPA ${res.status}`);
  }

  // Auth login
  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const loginBody = await loginRes.json().catch(() => ({}));
  const setCookie = loginRes.headers.getSetCookie?.() || [];
  const cookieHeader = setCookie.map((c) => c.split(';')[0]).join('; ');

  if (!loginRes.ok) {
    bad('POST /api/auth/login', `${loginRes.status} ${loginBody.error || JSON.stringify(loginBody)}`);
    process.exit(1);
  }
  if (!cookieHeader) {
    bad('POST /api/auth/login', 'no Set-Cookie session');
    process.exit(1);
  }
  ok('POST /api/auth/login', 'session cookie issued');

  const authHeaders = {
    Accept: 'application/json',
    Cookie: cookieHeader,
  };

  const me = await fetch(`${base}/api/auth/me`, { headers: authHeaders });
  const meBody = await me.json().catch(() => ({}));
  if (!me.ok) bad('GET /api/auth/me', `${me.status}`);
  else ok('GET /api/auth/me', meBody.user?.email || meBody.email || 'authenticated');

  const claims = await fetch(`${base}/api/insurance/claims?limit=5`, { headers: authHeaders });
  if (claims.status === 401 || claims.status === 403) {
    bad('GET /api/insurance/claims', `${claims.status}`);
  } else if (claims.status >= 500) {
    bad('GET /api/insurance/claims', `${claims.status}`);
  } else {
    ok('GET /api/insurance/claims', `${claims.status} (claims list reachable)`);
  }

  const integrations = await fetch(`${base}/api/admin/integrations`, { headers: authHeaders });
  const integBody = await integrations.json().catch(() => ({}));
  if (!integrations.ok && integrations.status !== 404) {
    // 403 means role gate — still proves route exists; seed owner should pass
    bad('GET /api/admin/integrations', `${integrations.status} ${integBody.error || ''}`);
  } else if (integrations.status === 404) {
    bad('GET /api/admin/integrations', '404 — route missing');
  } else {
    ok('GET /api/admin/integrations', `${integrations.status}`);
  }

  // Billing page shell (Stripe test keys optional)
  const billing = await fetchText('/billing');
  if (billing.res.status === 200) ok('GET /billing', 'page shell');
  else bad('GET /billing', `status ${billing.res.status}`);

  // Retired patient-pay must not be a public success
  const pay = await fetch(`${base}/api/public/pay/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`);
  if (pay.status === 200) bad('retired pay route', 'returned 200');
  else ok('retired pay route', `${pay.status} (not a public pay API)`);

  console.log('');
  if (fail) {
    console.error('Staging product-path smoke FAILED');
    process.exit(1);
  }
  console.log('Staging product-path smoke PASSED');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
