#!/usr/bin/env node
/**
 * Startup smoke scan for Electron (or manual). Emails khalid@collectrx.ca on failure.
 *
 *   node scripts/startup-scan.mjs
 *   COLLECTRX_API_ORIGIN=https://www.collectrx.ca node scripts/startup-scan.mjs
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { runLiveSmokeChecks } from './lib/liveSmokeChecks.mjs';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function scanDisabled() {
  return ['0', 'false', 'no'].includes(
    (process.env.STARTUP_HEALTH_SCAN_ENABLED || '').trim().toLowerCase(),
  );
}

function resolveApiOrigin() {
  const candidates = [
    process.env.COLLECTRX_API_ORIGIN,
    process.env.SMOKE_BASE_URL,
    process.env.PUBLIC_APP_URL,
    process.env.SERVER_URL,
    process.env.VITE_API_ORIGIN,
  ];
  for (const raw of candidates) {
    const t = (raw || '').trim().replace(/\/$/, '');
    if (t && /^https?:\/\//i.test(t)) return t;
  }
  return 'http://127.0.0.1:3000';
}

if (scanDisabled()) {
  console.log('[startup-scan] Disabled (STARTUP_HEALTH_SCAN_ENABLED=0)');
  process.exit(0);
}

const baseUrl = resolveApiOrigin();
console.log(`[startup-scan] Scanning ${baseUrl}…`);

const results = await runLiveSmokeChecks(baseUrl);
const failed = results.filter((r) => !r.ok);

for (const r of results) {
  const icon = r.ok ? '✓' : '✗';
  console.log(`${icon} ${r.label}${r.detail ? ` — ${r.detail}` : ''}`);
}

if (failed.length === 0) {
  console.log('[startup-scan] All checks passed');
  process.exit(0);
}

console.log(`[startup-scan] ${failed.length} issue(s) — sending alert email…`);

const { runCommand } = await import('./lib/breakageReport.mjs');
const payload = JSON.stringify(
  failed.map((f) => ({ id: f.id, label: f.label, detail: f.detail })),
);
const r = await runCommand(
  'npx',
  ['tsx', 'scripts/send-startup-alert.ts', payload, baseUrl, 'electron-launch'],
  { cwd: pkgRoot },
);

process.exit(r.ok ? 0 : 1);
