#!/usr/bin/env node
/**
 * Run breakage checks and print a report. Use --alert to notify ops channels.
 *
 *   npm run diagnose
 *   npm run diagnose -- --alert --live
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { printBreakageReport, runCommand } from './lib/breakageReport.mjs';
import { runDiagnosis } from './lib/runDiagnosis.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, '..');

const args = process.argv.slice(2);
const skipTests = args.includes('--skip-tests');
const skipTypecheck = args.includes('--skip-typecheck');
const live = args.includes('--live') || Boolean(process.env.SMOKE_BASE_URL);
const sendAlert = args.includes('--alert') || ['1', 'true', 'yes'].includes((process.env.OPS_ALERTS_ON_DIAGNOSE || '').toLowerCase());

console.log('CollectRx breakage diagnosis');
console.log(`Package: ${pkgRoot}`);

const results = await runDiagnosis(pkgRoot, { skipTests, skipTypecheck, live });
const code = printBreakageReport(results);

if (sendAlert && code !== 0) {
  console.log('\nSending ops alerts for failures…');
  await runCommand('npx', ['tsx', 'scripts/send-ops-alerts.ts', ...(live ? ['--live'] : [])], {
    cwd: pkgRoot,
  });
}

process.exit(code);
