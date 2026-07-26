#!/usr/bin/env node
/**
 * Copy selected local .env integration keys → Fly staging secrets.
 * Never prints secret values. Usage:
 *   node scripts/set-staging-integration-secrets.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const envPath = resolve(root, '.env');
const APP = process.env.FLY_STAGING_APP || 'collect-rx-staging';

const KEYS = [
  'SENDGRID_API_KEY',
  'SENDGRID_FROM_EMAIL',
  'SENDGRID_FROM_NAME',
  'VAPI_API_KEY',
  'VAPI_WEBHOOK_SECRET',
  'VAPI_PHONE_NUMBER_ID',
  'VAPI_SQUAD_ID',
  'VAPI_PREVISIT_SQUAD_ID',
];

function parseEnv(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1);
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const env = parseEnv(readFileSync(envPath, 'utf8'));
const pairs = [];
for (const key of KEYS) {
  const v = (env[key] || '').trim();
  if (!v || v.includes('your_') || v.includes('_here')) {
    console.log(`skip ${key} (missing or placeholder)`);
    continue;
  }
  pairs.push(`${key}=${v}`);
  console.log(`include ${key} (len=${v.length})`);
}

if (pairs.length === 0) {
  console.error('No integration secrets to set.');
  process.exit(1);
}

// --stage avoids blocking on unhealthy machines during crash loops; then deploy.
let r = spawnSync('flyctl', ['secrets', 'set', '-a', APP, '--stage', ...pairs], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: process.env,
});
if ((r.status ?? 1) !== 0) process.exit(r.status ?? 1);
r = spawnSync('flyctl', ['secrets', 'deploy', '-a', APP, '--detach'], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: process.env,
});
process.exit(r.status ?? 1);
