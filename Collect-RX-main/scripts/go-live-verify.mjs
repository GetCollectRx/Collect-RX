#!/usr/bin/env node
/**
 * Read-only go-live verification against a CollectRx host (default: production).
 * Does not mutate data. Run: node scripts/go-live-verify.mjs [baseUrl]
 */
const base = (process.argv[2] || process.env.PUBLIC_APP_URL || 'https://www.collectrx.ca')
  .trim()
  .replace(/\/$/, '');

const checks = [
  { name: 'GET /api/health', path: '/api/health', expect: (b) => b.status === 'ok' },
  { name: 'GET /api/health/ready', path: '/api/health/ready', expect: (b) => b.status === 'ready' || b.status === 'not_ready' },
  { name: 'GET /api/desktop/releases', path: '/api/desktop/releases', expect: (b) => b.success === true || Array.isArray(b.data?.assets) },
  { name: 'Protected route 401', path: '/api/insurance/claims', expect: () => true, status: 401 },
];

let failed = 0;
console.log(`[go-live-verify] ${base}\n`);

for (const c of checks) {
  try {
    const res = await fetch(`${base}${c.path}`);
    const body = c.status ? null : await res.json().catch(() => ({}));
    const ok = c.status ? res.status === c.status : res.ok && c.expect(body);
    console.log(ok ? '✓' : '✗', c.name, ok ? '' : `(HTTP ${res.status})`);
    if (!ok) failed++;
  } catch (e) {
    console.log('✗', c.name, (e).message);
    failed++;
  }
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
