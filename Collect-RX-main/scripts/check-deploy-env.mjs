#!/usr/bin/env node
/**
 * Deployment env checklist (prints names only — never secret values).
 * Usage: node scripts/check-deploy-env.mjs
 * Loads Collect-RX-main/.env when run from package root.
 */
import 'dotenv/config';

const prod = process.env.NODE_ENV === 'production';

function ok(name, present, hint = '') {
  const s = present ? '✓' : '✗';
  console.log(`${s} ${name}${hint ? ` — ${hint}` : ''}`);
  return present;
}

let bad = 0;

console.log(`NODE_ENV=${process.env.NODE_ENV || '(unset)'}\n`);

bad += !ok('DATABASE_URL', Boolean((process.env.DATABASE_URL || '').trim()), 'required') ? 1 : 0;

/** Same rules as src/server/databaseTls.ts — Postgres in prod must use TLS on the wire */
function postgresUrlUsesStrictSsl(databaseUrl) {
  const trimmed = (databaseUrl || '').trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (!lower.startsWith('postgresql://') && !lower.startsWith('postgres://')) return true;
  const qIndex = trimmed.indexOf('?');
  if (qIndex === -1) return false;
  const query = trimmed.slice(qIndex + 1).split('#')[0];
  try {
    const params = new URLSearchParams(query);
    const sslmode = (params.get('sslmode') || '').toLowerCase();
    if (['require', 'verify-ca', 'verify-full'].includes(sslmode)) return true;
    if (params.get('ssl') === 'true') return true;
    return false;
  } catch {
    return false;
  }
}

if (prod) {
  const dbUrl = (process.env.DATABASE_URL || '').trim();
  if (dbUrl && !postgresUrlUsesStrictSsl(dbUrl)) {
    bad += !ok(
      'DATABASE_URL (TLS)',
      false,
      'PostgreSQL URL must include sslmode=require (or verify-full / verify-ca) or ssl=true — see docs/operations/DATA-ENCRYPTION.md',
    )
      ? 1
      : 0;
  }
}

function phiEncryptionKeyValid() {
  const raw = (process.env.PHI_ENCRYPTION_KEY || '').trim();
  if (!raw) return false;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return true;
  try {
    return Buffer.from(raw, 'base64').length === 32;
  } catch {
    return false;
  }
}

const phiAtRestEnabled = ['1', 'true', 'yes'].includes(
  (process.env.PHI_ENCRYPTION_AT_REST || '').trim().toLowerCase(),
);
if (prod && phiAtRestEnabled) {
  bad += !ok(
    'PHI_ENCRYPTION_KEY',
    phiEncryptionKeyValid(),
    'required when PHI_ENCRYPTION_AT_REST is on — 64 hex chars or base64 of 32 bytes; load from KMS — see docs/operations/DATA-ENCRYPTION.md',
  )
    ? 1
    : 0;
}
if (prod) {
  bad += !ok('JWT_SECRET', Boolean((process.env.JWT_SECRET || '').trim()), 'required in production') ? 1 : 0;
  bad += !ok(
    'VAPI_WEBHOOK_SECRET',
    Boolean((process.env.VAPI_WEBHOOK_SECRET || '').trim()),
    'required — server refuses start without it',
  ) ? 1 : 0;
  bad += !ok(
    'SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY',
    Boolean((process.env.SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY || '').trim()),
    'required — unsigned webhooks get 401',
  ) ? 1 : 0;
  const sk = (process.env.STRIPE_SECRET_KEY || '').trim();
  if (sk.startsWith('sk_live_')) {
    bad += !ok('STRIPE_WEBHOOK_SECRET', Boolean((process.env.STRIPE_WEBHOOK_SECRET || '').trim()), 'required with live Stripe key') ? 1 : 0;
  }
  const emrUrl = (process.env.EMR_SYNC_WEBHOOK_URL || '').trim();
  if (emrUrl && !emrUrl.toLowerCase().startsWith('https://')) {
    bad += !ok('EMR_SYNC_WEBHOOK_URL (https)', false, 'must use https in production') ? 1 : 0;
  }
  if (process.env.EMR_OUTBOX_DEV_ACK === '1' || process.env.EMR_OUTBOX_DEV_ACK === 'true') {
    bad += !ok('EMR_OUTBOX_DEV_ACK', false, 'must not be enabled in production') ? 1 : 0;
  }
} else {
  ok('JWT_SECRET', Boolean((process.env.JWT_SECRET || '').trim()), 'set a strong value before production');
  ok(
    'VAPI_WEBHOOK_SECRET',
    Boolean((process.env.VAPI_WEBHOOK_SECRET || '').trim()),
    'optional in dev (verification skipped if unset)',
  );
  ok(
    'SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY',
    Boolean((process.env.SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY || '').trim()),
    'optional in dev',
  );
}

const stripe = Boolean((process.env.STRIPE_SECRET_KEY || '').trim());
ok('STRIPE_SECRET_KEY', stripe, 'optional if no payments');
ok('STRIPE_WEBHOOK_SECRET', Boolean((process.env.STRIPE_WEBHOOK_SECRET || '').trim()), stripe ? 'set when using Stripe webhooks' : 'optional');

ok('TRUST_PROXY', process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true' || prod, prod ? 'auto-enabled in production on API' : 'set TRUST_PROXY=1 behind Railway/nginx if needed');

ok(
  'ALLOWED_ORIGINS',
  Boolean(
    (process.env.ALLOWED_ORIGINS ||
      process.env['Allowed Origins'] ||
      process.env.ALLOWED_ORIGIN ||
      process.env.allowed_origins ||
      ''
    ).trim(),
  ),
  'comma list for browser CORS; use variable name ALLOWED_ORIGINS on Railway when possible',
);

ok('REDIS_URL', Boolean((process.env.REDIS_URL || '').trim()), 'optional — enables shared rate limits + worker');

ok(
  'PHI_ENCRYPTION_KEY',
  !phiAtRestEnabled || phiEncryptionKeyValid(),
  phiAtRestEnabled ? 'required when PHI_ENCRYPTION_AT_REST is on' : 'optional unless PHI_ENCRYPTION_AT_REST',
);

ok(
  'HEALTH_METRICS_TOKEN',
  Boolean((process.env.HEALTH_METRICS_TOKEN || '').trim()),
  prod ? 'recommended — protects /api/health/metrics deployment flags' : 'optional in dev',
);

ok('TWILIO_AUTH_TOKEN', Boolean((process.env.TWILIO_AUTH_TOKEN || '').trim()), 'optional — inbound SMS signature verification');
ok('TWILIO_SMS_INBOUND_URL', Boolean((process.env.TWILIO_SMS_INBOUND_URL || '').trim()), 'must match Twilio webhook URL exactly when using signature verify');

console.log('');
if (bad > 0) {
  console.error(`Check failed: ${bad} required variable(s) missing or empty for this NODE_ENV.`);
  process.exit(1);
}
console.log('Required variables for this environment are set.');
process.exit(0);
