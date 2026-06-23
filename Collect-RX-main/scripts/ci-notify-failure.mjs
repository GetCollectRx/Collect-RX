#!/usr/bin/env node
/**
 * Post CI failure to OPS_ALERT_WEBHOOK_URL with impact + fixes.
 */
const webhook = process.env.OPS_ALERT_WEBHOOK_URL?.trim();
if (!webhook) {
  console.log('[ci-notify] OPS_ALERT_WEBHOOK_URL not set — skip');
  process.exit(0);
}

const ref = process.env.GITHUB_REF_NAME || process.env.GITHUB_REF || 'unknown';
const sha = (process.env.GITHUB_SHA || '').slice(0, 7);
const runUrl =
  process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : '';

const impact = [
  'Merges to main may be blocked or unsafe',
  'Production deploy assuming CI-green is invalid',
  'Regressions may exist in auth, billing, PHI, or Canadian expansion',
];
const fixes = [
  'Open the failed GitHub Actions run and read the failing step',
  'Reproduce locally: cd Collect-RX-main && npm run diagnose',
  'Download the vitest-junit artifact if tests failed',
  'Fix failing tests before merging',
];

const text =
  `*CollectRx CI FAILED*\n` +
  `Branch: \`${ref}\` · Commit: \`${sha}\`\n` +
  (runUrl ? `<${runUrl}|View run>\n` : '') +
  `\n*Impact*\n${impact.map((i) => `• ${i}`).join('\n')}\n` +
  `\n*Fix*\n${fixes.map((f, i) => `${i + 1}. ${f}`).join('\n')}`;

const res = await fetch(webhook, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text, blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }] }),
});

if (!res.ok) {
  console.error('[ci-notify] Webhook failed', res.status, await res.text());
  process.exit(1);
}
console.log('[ci-notify] Posted CI failure alert');
process.exit(0);
