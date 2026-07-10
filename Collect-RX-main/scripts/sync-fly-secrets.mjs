#!/usr/bin/env node
/**
 * Push selected secrets from Collect-RX-main/.env to Fly app `collect-rx`.
 * Usage (from repo root): node Collect-RX-main/scripts/sync-fly-secrets.mjs
 * Dry run: DRY_RUN=1 node Collect-RX-main/scripts/sync-fly-secrets.mjs
 *
 * Never commit .env. Requires: fly auth login, flyctl on PATH.
 */
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');
const app = process.env.FLY_APP || 'collect-rx';
const dryRun = process.env.DRY_RUN === '1';

const SECRET_KEYS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'VAPI_WEBHOOK_SECRET',
  'VAPI_API_KEY',
  'VAPI_SQUAD_ID',
  'VAPI_PHONE_NUMBER_ID',
  'PHI_ENCRYPTION_KEY',
  'SENTRY_DSN',
  'VITE_SENTRY_DSN',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'SENDGRID_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_FROM_NUMBER',
  'TWILIO_SMS_INBOUND_URL',
  'REDIS_URL',
  'PLATFORM_DEV_PASSWORD',
  'SEED_PRACTICE_PASSWORD',
];

function parseEnvFile(path) {
  if (!existsSync(path)) {
    console.error(`Missing ${path}`);
    process.exit(1);
  }
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const env = parseEnvFile(envPath);
const pairs = SECRET_KEYS.filter((k) => env[k] && env[k].trim()).map((k) => `${k}=${env[k].trim()}`);

if (pairs.length === 0) {
  console.error('No secret keys found in .env — nothing to sync.');
  process.exit(1);
}

console.log(`Syncing ${pairs.length} secret(s) to Fly app ${app}${dryRun ? ' (dry run)' : ''}…`);
console.log('Keys:', pairs.map((p) => p.split('=')[0]).join(', '));

if (dryRun) {
  console.log('DRY_RUN=1 — not calling fly secrets set.');
  process.exit(0);
}

const input = pairs.join('\n') + '\n';
const r = spawnSync('fly', ['secrets', 'import', '--app', app], {
  input,
  stdio: ['pipe', 'inherit', 'inherit'],
  encoding: 'utf8',
});

if (r.status !== 0) {
  console.error('fly secrets import failed');
  process.exit(r.status ?? 1);
}

console.log('Done. Redeploy may be required: fly deploy --app', app);
