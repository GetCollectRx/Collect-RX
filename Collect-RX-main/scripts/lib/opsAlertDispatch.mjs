/**
 * Dispatch alerts from Node scripts (smoke-live) via tsx + opsAlerts.ts
 */
import { runCommand } from './breakageReport.mjs';

/**
 * @param {string} pkgRoot
 * @param {Array<{ id: string, detail?: string, label?: string }>} failed
 */
export async function dispatchAlertsForFailures(pkgRoot, failed) {
  if (failed.length === 0) return { sent: 0 };
  const payload = JSON.stringify(failed);
  const r = await runCommand(
    'npx',
    ['tsx', 'scripts/dispatch-alert-batch.ts', payload],
    { cwd: pkgRoot },
  );
  return { sent: r.ok ? failed.length : 0, ok: r.ok };
}
