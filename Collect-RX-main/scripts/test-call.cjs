#!/usr/bin/env node
// One plain outbound test call through Vapi, to prove dialing works from your machine.
// Usage: node scripts/test-call.cjs +16135018951 --confirm
// Reads VAPI_API_KEY and VAPI_PHONE_NUMBER_ID from .env. Changes no configuration.
// The call says one sentence and hangs up. It does not use the squad, record, or touch claims.
const fs = require('fs');
const path = require('path');
const to = process.argv[2];
if (!/^\+1\d{10}$/.test(to || '') || !process.argv.includes('--confirm')) {
  console.error('Usage: node scripts/test-call.cjs +1XXXXXXXXXX --confirm'); process.exit(2);
}
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, '../.env'), 'utf8').split('\n')
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]));
if (!env.VAPI_API_KEY || !env.VAPI_PHONE_NUMBER_ID) { console.error('Missing VAPI_API_KEY or VAPI_PHONE_NUMBER_ID in .env'); process.exit(2); }
(async () => {
  const res = await fetch('https://api.vapi.ai/call', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.VAPI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phoneNumberId: env.VAPI_PHONE_NUMBER_ID,
      customer: { number: to },
      assistant: {
        firstMessage: 'This is a CollectRx test call. No action is needed. Goodbye.',
        endCallFunctionEnabled: true,
        maxDurationSeconds: 30,
        model: { provider: 'openai', model: 'gpt-4o-mini', messages: [{ role: 'system', content: 'Say the first message, then end the call.' }] },
        artifactPlan: { recordingEnabled: false },
      },
    }),
  });
  const body = await res.json().catch(() => ({}));
  console.log(res.status, body.id || body.message || '');
  process.exit(res.ok ? 0 : 1);
})();
