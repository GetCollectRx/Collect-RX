#!/usr/bin/env node
/**
 * CollectRx — Agent Test Orchestrator
 *
 * Runs all validation agents via Vitest, generates a human-readable report,
 * and exits with a non-zero code if any agent failed.
 *
 * Usage:
 *   node scripts/run-agents.mjs              # Run all agents
 *   node scripts/run-agents.mjs --agent 01   # Run a specific agent by number
 *   node scripts/run-agents.mjs --report     # Output JSON report to agents-report.json
 *   node scripts/run-agents.mjs --help       # Show this help
 */

import { execSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const AGENTS_DIR = join(ROOT, 'tests', 'agents');
const REPORT_DIR = join(ROOT, 'test-results');

const AGENTS = [
  {
    id: '01',
    name: 'Carrier Config Validator',
    file: '01-carrier-config-agent.test.ts',
    description: 'Validates carrier-configs.json completeness, coverage %, deductibles, annual max, TELUS rules, waiting periods, and frequency limits.',
    critical: true,
  },
  {
    id: '02',
    name: 'CDT Code Coverage Validator',
    file: '02-cdt-coverage-agent.test.ts',
    description: 'Validates CDT code → coverage tier mappings for canonical codes, fallback handling, and tier accuracy.',
    critical: true,
  },
  {
    id: '03',
    name: 'API Surface Validator',
    file: '03-api-surface-agent.test.ts',
    description: 'Validates all protected API routes require auth (401), health endpoints are public, and security headers are present.',
    critical: true,
  },
  {
    id: '04',
    name: 'PHI Boundary Validator',
    file: '04-phi-boundary-agent.test.ts',
    description: 'CRITICAL: Validates PHI tokenization (PHIPA/PIPEDA compliance). Token format, lifecycle, bulk safety, and boundary contract.',
    critical: true,
  },
  {
    id: '05',
    name: 'Call Rules & CARRIER_BLOCK Validator',
    file: '05-call-rules-agent.test.ts',
    description: 'Validates CARRIER_BLOCK phrase detection, claim age eligibility (30–90 days), max 3 attempts, call window (Mon–Fri 8–5 ET), TELUS vs standard wait days.',
    critical: true,
  },
  {
    id: '06',
    name: 'Eligibility Edge Cases Agent',
    file: '06-eligibility-edge-agent.test.ts',
    description: 'Extended eligibility tests: Manulife/RBC/Green Shield specifics, TELUS TPA mapping, boundary math, multi-procedure consistency, confidence scoring.',
    critical: false,
  },
  {
    id: '07',
    name: 'Recovery Gate Safety Agent',
    file: '07-recovery-safety-agent.test.ts',
    description: 'Validates dispatch gate blocking routes, BLOCKING action types, ON_HOLD status, recall timing, and claim router standard scenarios.',
    critical: true,
  },
  {
    id: '08',
    name: 'Data Integrity Agent',
    file: '08-data-integrity-agent.test.ts',
    description: 'Cross-cutting data consistency: carrier key alignment, provincial fee guide math, CDCP federal config, coverage tier references, estimate math identity.',
    critical: false,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CLI Parsing
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const showHelp = args.includes('--help') || args.includes('-h');
const outputReport = args.includes('--report');
const agentFlag = args.indexOf('--agent');
const specificAgent = agentFlag >= 0 ? args[agentFlag + 1] : null;

if (showHelp) {
  console.log(`
CollectRx Agent Test Orchestrator
==================================

Agents:
${AGENTS.map((a) => `  [${a.id}] ${a.name}${a.critical ? ' ⚠ CRITICAL' : ''}`).join('\n')}

Commands:
  node scripts/run-agents.mjs                Run all agents
  node scripts/run-agents.mjs --agent 01     Run agent 01 only
  node scripts/run-agents.mjs --report       Write JSON report to test-results/agents-report.json
  node scripts/run-agents.mjs --help         Show this help
`);
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

function banner(text) {
  const line = '─'.repeat(70);
  console.log(`\n${CYAN}${line}${RESET}`);
  console.log(`${BOLD}${CYAN}  ${text}${RESET}`);
  console.log(`${CYAN}${line}${RESET}\n`);
}

function runAgent(agent) {
  const testFile = join(AGENTS_DIR, agent.file);
  const start = Date.now();

  console.log(`${BOLD}[${agent.id}] ${agent.name}${RESET}${agent.critical ? ` ${YELLOW}⚠ CRITICAL${RESET}` : ''}`);
  console.log(`${DIM}    ${agent.description}${RESET}`);
  console.log('');

  const result = spawnSync(
    'npx',
    ['vitest', 'run', '--reporter=verbose', testFile],
    {
      cwd: ROOT,
      stdio: ['inherit', 'pipe', 'pipe'],
      encoding: 'utf8',
      env: {
        ...process.env,
        STRIPE_SECRET_KEY: 'sk_test_4eC39HqLyjWDarjtT1zdp7dc',
        STRIPE_WEBHOOK_SECRET: 'whsec_test_00000000000000000000000000000000',
      },
    }
  );

  const elapsed = Date.now() - start;
  const passed = result.status === 0;

  // Print stdout/stderr
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const passedTests = (result.stdout.match(/✓|✔|PASS/g) ?? []).length;
  const failedTests = (result.stdout.match(/✗|✘|×|FAIL|failed/gi) ?? []).length;

  const status = passed
    ? `${GREEN}✓ PASSED${RESET}`
    : `${RED}✗ FAILED${RESET}`;
  const criticalNote = !passed && agent.critical ? ` ${RED}${BOLD}[CRITICAL — STOP AND INVESTIGATE]${RESET}` : '';

  console.log(`    ${status} in ${elapsed}ms${criticalNote}\n`);

  return {
    id: agent.id,
    name: agent.name,
    file: agent.file,
    critical: agent.critical,
    passed,
    elapsed,
    passedTests,
    failedTests,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

banner('CollectRx Agent Validation Suite');

const agentsToRun = specificAgent
  ? AGENTS.filter((a) => a.id === specificAgent)
  : AGENTS;

if (agentsToRun.length === 0) {
  console.error(`${RED}No agent found with id "${specificAgent}". Valid ids: ${AGENTS.map((a) => a.id).join(', ')}${RESET}`);
  process.exit(1);
}

console.log(`Running ${agentsToRun.length} agent(s)...\n`);

const results = [];
for (const agent of agentsToRun) {
  const result = runAgent(agent);
  results.push(result);
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary Report
// ─────────────────────────────────────────────────────────────────────────────

banner('Agent Validation Summary');

const passed = results.filter((r) => r.passed);
const failed = results.filter((r) => !r.passed);
const criticalFailed = failed.filter((r) => r.critical);

console.log(`  Total agents:    ${results.length}`);
console.log(`  ${GREEN}Passed:${RESET}          ${passed.length}`);
console.log(`  ${failed.length > 0 ? RED : GREEN}Failed:${RESET}          ${failed.length}${failed.length > 0 && criticalFailed.length > 0 ? ` (${criticalFailed.length} critical)` : ''}`);
console.log('');

const tableHeader = `  ${'ID'.padEnd(4)} ${'Status'.padEnd(10)} ${'Time'.padEnd(8)} ${'Tests'.padEnd(8)} Agent`;
const tableLine = '  ' + '─'.repeat(68);
console.log(tableHeader);
console.log(tableLine);

for (const r of results) {
  const status = r.passed ? `${GREEN}✓ PASS${RESET}` : `${RED}✗ FAIL${RESET}`;
  const critical = !r.passed && r.critical ? ` ${YELLOW}⚠${RESET}` : '';
  const time = `${r.elapsed}ms`.padEnd(8);
  const tests = `${r.passed ? r.passedTests : '?'} ok`.padEnd(8);
  console.log(`  ${r.id.padEnd(4)} ${status}   ${time} ${tests} ${r.name}${critical}`);
}

console.log('');

if (failed.length > 0) {
  console.log(`${RED}${BOLD}FAILED AGENTS:${RESET}`);
  for (const r of failed) {
    console.log(`  ${RED}✗ [${r.id}] ${r.name}${r.critical ? ' ⚠ CRITICAL' : ''}${RESET}`);
  }
  console.log('');
}

if (criticalFailed.length > 0) {
  console.log(`${RED}${BOLD}⚠ CRITICAL FAILURES — These must be resolved before any deployment:${RESET}`);
  for (const r of criticalFailed) {
    console.log(`  ${RED}  • [${r.id}] ${r.name}${RESET}`);
  }
  console.log('');
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON Report
// ─────────────────────────────────────────────────────────────────────────────

if (outputReport) {
  mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = join(REPORT_DIR, 'agents-report.json');
  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      total: results.length,
      passed: passed.length,
      failed: failed.length,
      criticalFailed: criticalFailed.length,
      allPassed: failed.length === 0,
    },
    agents: results.map((r) => ({
      id: r.id,
      name: r.name,
      file: r.file,
      critical: r.critical,
      passed: r.passed,
      elapsed: r.elapsed,
      passedTests: r.passedTests,
      failedTests: r.failedTests,
    })),
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`${GREEN}Report written to: ${reportPath}${RESET}\n`);
}

process.exit(failed.length > 0 ? 1 : 0);
