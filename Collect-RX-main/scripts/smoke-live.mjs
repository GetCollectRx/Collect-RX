#!/usr/bin/env node
/**
 * Live HTTP smoke — run against a running CollectRx API (local, staging, or prod).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { printBreakageReport } from './lib/breakageReport.mjs';
import { runLiveSmokeChecks } from './lib/liveSmokeChecks.mjs';
import { failedChecks } from './lib/runDiagnosis.mjs';
import { dispatchAlertsForFailures } from './lib/opsAlertDispatch.mjs';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const baseUrl = (
  flag('--base-url') ||
  process.env.SMOKE_BASE_URL ||
  process.env.PUBLIC_APP_URL ||
  'http://127.0.0.1:3000'
).replace(/\/$/, '');

console.log(`Live smoke target: ${baseUrl}\n`);

const results = await runLiveSmokeChecks(baseUrl);
const code = printBreakageReport(results, { title: `LIVE SMOKE — ${baseUrl}` });

const alertOnFail =
  code !== 0 &&
  (['1', 'true', 'yes'].includes((process.env.OPS_ALERTS_ENABLED || '').toLowerCase()) ||
    ['1', 'true', 'yes'].includes((process.env.OPS_ALERTS_ON_SMOKE_FAIL || '').toLowerCase()));

if (alertOnFail) {
  await dispatchAlertsForFailures(pkgRoot, failedChecks(results));
}

process.exit(code);
