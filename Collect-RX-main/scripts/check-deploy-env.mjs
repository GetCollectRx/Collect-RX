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

ok('ALLOWED_ORIGINS', Boolean((process.env.ALLOWED_ORIGINS || '').trim()), 'comma list for browser CORS; localhost defaults in dev');

ok('REDIS_URL', Boolean((process.env.REDIS_URL || '').trim()), 'optional — enables shared rate limits + worker');

ok('TWILIO_AUTH_TOKEN', Boolean((process.env.TWILIO_AUTH_TOKEN || '').trim()), 'optional — inbound SMS signature verification');
ok('TWILIO_SMS_INBOUND_URL', Boolean((process.env.TWILIO_SMS_INBOUND_URL || '').trim()), 'must match Twilio webhook URL exactly when using signature verify');

console.log('');
if (bad > 0) {
  console.error(`Check failed: ${bad} required variable(s) missing or empty for this NODE_ENV.`);
  process.exit(1);
}
console.log('Required variables for this environment are set.');
process.exit(0);
