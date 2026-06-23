/**
 * Shared diagnosis steps — used by diagnose-breakage.mjs and send-ops-alerts.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseVitestFailures, runCommand } from './breakageReport.mjs';

/**
 * @param {string} pkgRoot
 * @param {{ skipTests?: boolean, skipTypecheck?: boolean, live?: boolean }} opts
 * @returns {Promise<import('./breakageReport.mjs').CheckResult[]>}
 */
export async function runDiagnosis(pkgRoot, opts = {}) {
  const { skipTests = false, skipTypecheck = false, live = false } = opts;
  /** @type {import('./breakageReport.mjs').CheckResult[]} */
  const results = [];

  function hasDatabaseUrl() {
    const url = (process.env.DATABASE_URL || '').trim();
    return url.startsWith('postgresql://') || url.startsWith('postgres://');
  }

  if (skipTypecheck) {
    results.push({
      id: 'typescript',
      label: 'TypeScript (typecheck)',
      ok: true,
      skipped: true,
      detail: '--skip-typecheck',
    });
  } else {
    const r = await runCommand('npm', ['run', 'typecheck'], { cwd: pkgRoot });
    results.push({
      id: 'typescript',
      label: 'TypeScript (typecheck)',
      ok: r.ok,
      detail: r.ok ? 'tsc --noEmit passed' : 'Compilation errors — see output above',
      fix: 'npm run typecheck',
    });
  }

  const envRun = await runCommand('npm', ['run', 'check:env'], { cwd: pkgRoot });
  results.push({
    id: 'env',
    label: 'Environment variables (check:env)',
    ok: envRun.ok,
    detail: envRun.ok
      ? `NODE_ENV=${process.env.NODE_ENV || 'development'}`
      : 'Missing or invalid required env vars',
    fix: 'npm run check:env — fix ✗ lines in .env or Railway variables',
  });

  if (!hasDatabaseUrl()) {
    results.push({
      id: 'database',
      label: 'Database schema (db:verify-tables)',
      ok: true,
      skipped: true,
      detail: 'DATABASE_URL not set — skipped',
      fix: 'Set DATABASE_URL, run: docker compose up -d && npm run db:migrate',
    });
  } else {
    const dbRun = await runCommand('npm', ['run', 'db:verify-tables'], { cwd: pkgRoot });
    results.push({
      id: 'database',
      label: 'Database schema (db:verify-tables)',
      ok: dbRun.ok,
      detail: dbRun.ok ? 'Critical tables present' : 'Schema or connectivity failure',
      fix: 'npm run db:migrate && npm run db:verify-tables',
    });
  }

  if (skipTests) {
    results.push({
      id: 'tests',
      label: 'Unit & integration tests (Vitest)',
      ok: true,
      skipped: true,
      detail: '--skip-tests',
    });
  } else {
    const outDir = join(pkgRoot, 'test-results');
    mkdirSync(outDir, { recursive: true });
    const jsonPath = join(outDir, 'vitest-results.json');
    const testRun = await runCommand(
      'npx',
      ['vitest', 'run', '--reporter=default', '--reporter=json', `--outputFile.json=${jsonPath}`],
      { cwd: pkgRoot },
    );
    let failures = [];
    if (existsSync(jsonPath)) {
      failures = parseVitestFailures(readFileSync(jsonPath, 'utf8'));
    }
    const summaryPath = join(outDir, 'failures.txt');
    if (failures.length) {
      writeFileSync(summaryPath, failures.join('\n') + '\n', 'utf8');
    }
    results.push({
      id: 'tests',
      label: 'Unit & integration tests (Vitest)',
      ok: testRun.ok,
      detail: testRun.ok
        ? 'All tests passed'
        : failures.length
          ? `${failures.length} failure(s) — first: ${failures[0]}`
          : 'Tests failed — see vitest output',
      fix: failures.length
        ? `npm test -- --reporter=verbose  (${summaryPath})`
        : 'npm test',
    });
  }

  if (!live) {
    results.push({
      id: 'live',
      label: 'Live API smoke (HTTP)',
      ok: true,
      skipped: true,
      detail: 'Pass --live or set SMOKE_BASE_URL',
      fix: 'npm run smoke:live',
    });
  } else {
    const liveRun = await runCommand('node', ['scripts/smoke-live.mjs'], { cwd: pkgRoot });
    results.push({
      id: 'live',
      label: 'Live API smoke (HTTP)',
      ok: liveRun.ok,
      detail: liveRun.ok ? 'All live checks passed' : 'One or more HTTP checks failed',
      fix: 'npm run smoke:live',
    });
  }

  return results;
}

/**
 * @param {import('./breakageReport.mjs').CheckResult[]} results
 */
export function failedChecks(results) {
  return results.filter((r) => !r.ok && !r.skipped);
}
