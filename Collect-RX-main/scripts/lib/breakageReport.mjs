/**
 * Shared helpers for diagnose-breakage.mjs and smoke-live.mjs.
 */

/** @typedef {{ id: string, label: string, ok: boolean, detail?: string, fix?: string, skipped?: boolean }} CheckResult */

/**
 * @param {CheckResult[]} results
 * @param {{ title?: string }} [opts]
 */
export function printBreakageReport(results, opts = {}) {
  const title = opts.title ?? 'BREAKAGE REPORT';
  const width = 72;
  console.log('\n' + '='.repeat(width));
  console.log(title);
  console.log('='.repeat(width));

  const failed = results.filter((r) => !r.ok && !r.skipped);
  const skipped = results.filter((r) => r.skipped);
  const passed = results.filter((r) => r.ok && !r.skipped);

  for (const r of results) {
    const icon = r.skipped ? '○' : r.ok ? '✓' : '✗';
    const status = r.skipped ? 'SKIP' : r.ok ? 'PASS' : 'FAIL';
    console.log(`${icon} [${status}] ${r.label}`);
    if (r.detail) console.log(`         ${r.detail}`);
    if (!r.ok && !r.skipped && r.fix) console.log(`         → Fix: ${r.fix}`);
    if (!r.ok && !r.skipped) console.log(`         → Alert: OPS_ALERTS_ENABLED=1 npm run diagnose -- --alert`);
  }

  console.log('-'.repeat(width));
  console.log(
    `Summary: ${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped (${results.length} checks)`,
  );

  if (failed.length) {
    console.log('\nWhat to do next:');
    for (const r of failed) {
      console.log(`  • ${r.label}${r.fix ? ` — ${r.fix}` : ''}`);
    }
    console.log('');
    return 1;
  }

  if (skipped.length && !passed.length) {
    console.log('\nAll runnable checks were skipped. Set DATABASE_URL or pass --live for more coverage.\n');
    return 1;
  }

  console.log('\nNo failures detected in this run.\n');
  return 0;
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd?: string, env?: Record<string, string> }} [opts]
 * @returns {Promise<{ ok: boolean, code: number, stdout: string, stderr: string }>}
 */
export async function runCommand(cmd, args, opts = {}) {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd ?? process.cwd(),
      env: { ...process.env, ...opts.env },
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('close', (code) => {
      resolve({ ok: code === 0, code: code ?? 1, stdout, stderr });
    });
    child.on('error', () => {
      resolve({ ok: false, code: 1, stdout, stderr: stderr || `Failed to spawn ${cmd}` });
    });
  });
}

/**
 * Parse vitest json reporter output for failed test names.
 * @param {string} jsonText
 * @returns {string[]}
 */
export function parseVitestFailures(jsonText) {
  try {
    const data = JSON.parse(jsonText);
    const files = data.testResults ?? data.files ?? [];
    const failures = [];
    for (const file of files) {
      const filePath = file.name ?? file.filePath ?? 'unknown';
      const assertions = file.assertionResults ?? file.tasks ?? [];
      for (const a of assertions) {
        if (a.status === 'failed' || a.result?.state === 'fail') {
          const name = a.fullName ?? a.title ?? a.name ?? 'unknown test';
          failures.push(`${filePath} › ${name}`);
        }
      }
    }
    return failures;
  } catch {
    return [];
  }
}
