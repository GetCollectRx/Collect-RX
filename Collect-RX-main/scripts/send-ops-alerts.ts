#!/usr/bin/env npx tsx
/**
 * Send ops alerts for failed diagnosis or live smoke checks.
 *
 *   npm run alert:diagnosis
 *   npm run alert:diagnosis -- --live
 *   npx tsx scripts/send-ops-alerts.ts --from-results ./test-results/diagnosis.json
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alertsFromFailedChecks, dispatchOpsAlert } from '../src/server/observability/opsAlerts.js';
import { failedChecks, runDiagnosis } from './lib/runDiagnosis.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, '..');

const args = process.argv.slice(2);
const fromResults = args.includes('--from-results')
  ? args[args.indexOf('--from-results') + 1]
  : undefined;
const live = args.includes('--live') || Boolean(process.env.SMOKE_BASE_URL);

async function main() {
  let failed: Array<{ id: string; detail?: string; label?: string }>;

  if (fromResults) {
    const raw = JSON.parse(readFileSync(fromResults, 'utf8')) as Array<{
      id: string;
      ok: boolean;
      skipped?: boolean;
      detail?: string;
      label?: string;
    }>;
    failed = raw.filter((r) => !r.ok && !r.skipped);
  } else {
    const results = await runDiagnosis(pkgRoot, {
      skipTests: args.includes('--skip-tests'),
      skipTypecheck: args.includes('--skip-typecheck'),
      live,
    });
    failed = failedChecks(results);
  }

  if (failed.length === 0) {
    console.log('[alert] No failures — no alerts sent.');
    process.exit(0);
  }

  const payloads = alertsFromFailedChecks(failed, 'diagnosis');
  const outcomes = await Promise.all(payloads.map((p) => dispatchOpsAlert(p)));

  const sent = outcomes.filter((o) => o.sent).length;
  console.log(`[alert] Dispatched ${sent}/${payloads.length} alert(s) for: ${failed.map((f) => f.id).join(', ')}`);
  process.exit(sent > 0 || !process.env.OPS_ALERTS_ENABLED ? 0 : 1);
}

main().catch((err) => {
  console.error('[alert] Fatal:', err);
  process.exit(1);
});
