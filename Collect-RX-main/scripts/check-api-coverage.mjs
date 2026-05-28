#!/usr/bin/env node
/**
 * Static check: API path strings referenced from UI / desktop exist on the server.
 * Run: node scripts/check-api-coverage.mjs (from Collect-RX-main)
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SCAN_DIRS = ['src/pages', 'src/components', 'src/context', 'desktop'];
const EXT = /\.(tsx|ts|jsx|js)$/;

/** Paths we intentionally match loosely (templates, docs). */
const EXTRA_CLIENT_PATHS = [
  '/api/webhooks/sendgrid',
  '/api/webhooks/vapi',
  '/api/twilio/sms',
  '/api/stripe/webhook',
  '/api/health',
  '/api/health/ready',
];

/**
 * If a client path starts with any of these prefixes, it is considered covered
 * (Express routers + index.ts mounts).
 */
const SERVER_PREFIXES = [
  '/api/auth/',
  '/api/billing/',
  '/api/stripe/',
  '/api/insurance/',
  '/api/calls/',
  '/api/desk/',
  '/api/practices/',
  '/api/reports/',
  '/api/canadian/',
  '/api/carriers/',
  '/api/analytics/',
  '/api/telemetry/',
  '/api/eligibility/',
  '/api/queue/',
  '/api/dashboard/',
  '/api/admin/',
  '/api/cdcp/',
  '/api/work-queue/',
  '/api/benefits/',
  '/api/patients/',
  '/api/balances',
  '/api/outreach',
  '/api/pay/',
  '/api/public/',
  '/api/webhooks/',
  '/api/twilio/',
  '/api/health',
  '/api/group/',
];

/** Exact paths or prefix patterns not covered by SERVER_PREFIXES alone. */
const SERVER_EXTRA = [
  /^\/api\/balances$/,
  /^\/api\/balances\//,
  /^\/api\/outreach$/,
  /^\/api\/outreach\//,
  /^\/api\/pay\/[^/]+$/,
  /^\/api\/benefits\/[^/]+$/,
  /^\/api\/benefits\/estimate$/,
  /^\/api\/patients\/balances$/,
  /^\/api\/patients\/balances\//,
  /^\/api\/public\/pay\//,
  /^\/api\/public\/email-unsubscribe$/,
  /^\/api\/work-queue$/,
  /^\/api\/work-queue\//,
  /^\/api\/admin\/sync\//,
  /^\/api\/telemetry$/,
  /^\/api\/telemetry\//,
];

function walkFiles(absDir, acc) {
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const ent of entries) {
    const p = join(absDir, ent.name);
    if (ent.isDirectory()) walkFiles(p, acc);
    else if (EXT.test(ent.name)) acc.push(p);
  }
  return acc;
}

function stripQuery(p) {
  const i = p.indexOf('?');
  return i === -1 ? p : p.slice(0, i);
}

function extractFromSource(text) {
  const out = new Set();
  for (const m of text.matchAll(/["'](\/api\/[a-zA-Z0-9_/.-]+)(\?[^"'`]*)?["']/g)) {
    out.add(stripQuery(m[1]));
  }
  for (const m of text.matchAll(/`(\/api\/[a-zA-Z0-9_/.-]+)\$\{/g)) {
    out.add(m[1]);
  }
  return out;
}

function isCovered(path) {
  const p = stripQuery(path);
  for (const re of SERVER_EXTRA) {
    if (re.test(p)) return true;
  }
  for (const prefix of SERVER_PREFIXES) {
    if (p === prefix || p.startsWith(prefix)) return true;
  }
  return false;
}

const files = [];
for (const d of SCAN_DIRS) {
  walkFiles(join(ROOT, d), files);
}

const clientPaths = new Set(EXTRA_CLIENT_PATHS);
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const p of extractFromSource(src)) clientPaths.add(p);
}

const missing = [...clientPaths].filter((p) => !isCovered(p)).sort();

if (missing.length) {
  console.error('[check-api-coverage] Client calls paths with no known server mount:\n');
  for (const p of missing) console.error('  ', p);
  process.exit(1);
}

console.log(
  `[check-api-coverage] OK — ${clientPaths.size} distinct /api paths from UI/desktop are covered.`,
);
