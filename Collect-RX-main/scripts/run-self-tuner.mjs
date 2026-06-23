#!/usr/bin/env node
/**
 * CollectRx — Self-Tuning Agent CLI
 *
 * Analyzes call outcomes, reconciliation data, and transcripts to
 * automatically update carrier rules, recall intervals, block phrases,
 * and confidence weights with minimal human supervision.
 *
 * Usage:
 *   node scripts/run-self-tuner.mjs                # Full cycle (auto-apply LOW-risk)
 *   node scripts/run-self-tuner.mjs --dry-run      # Analyze only, no changes
 *   node scripts/run-self-tuner.mjs --status       # Show ledger summary, no analysis
 *   node scripts/run-self-tuner.mjs --window 60    # Analyze last 60 days
 *   node scripts/run-self-tuner.mjs --practice ID  # Include reconciliation analysis
 *   node scripts/run-self-tuner.mjs --skip-tests   # Skip vitest (useful in CI)
 *   node scripts/run-self-tuner.mjs --help
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const RESET = '\x1b[0m';
const BOLD  = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED   = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN  = '\x1b[36m';
const DIM   = '\x1b[2m';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
${BOLD}CollectRx Self-Tuning Agent${RESET}

Learns from real call outcomes and automatically updates rules:
  • Adds new CARRIER_BLOCK detection phrases from transcripts
  • Adjusts recall intervals to match actual carrier processing times
  • Calibrates confidence scores from reconciliation data
  • Flags anomalous carrier behavior (block rate spikes, wait day drift)

${BOLD}Options:${RESET}
  --dry-run           Analyze and propose, but apply nothing
  --status            Show ledger summary only (no analysis)
  --window <days>     Analysis window (default: 30)
  --practice <id>     Practice ID for reconciliation variance analysis
  --skip-tests        Skip vitest validation (faster, less safe)
  --max-apply <n>     Max auto-apply per cycle (default: 5)
  --help              Show this help

${BOLD}Risk levels:${RESET}
  LOW    Auto-applied after test suite passes
  MEDIUM Queued for human review (${YELLOW}shown in pending list${RESET})
  HIGH   Queued for human review (requires explicit approval)
`);
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Status-only mode (no DB needed)
// ─────────────────────────────────────────────────────────────────────────────

if (args.includes('--status')) {
  const { getSelfTunerStatus } = await import('../src/server/learning/selfTuner/index.js');
  const status = getSelfTunerStatus();

  console.log(`\n${CYAN}${BOLD}Self-Tuner Ledger Summary${RESET}\n`);
  console.log(`  Total proposals:  ${status.totalProposals}`);
  console.log(`  ${GREEN}Applied:${RESET}          ${status.applied}`);
  console.log(`  ${YELLOW}Pending review:${RESET}   ${status.pending}`);
  console.log(`  ${RED}Rejected:${RESET}         ${status.rejected}`);
  console.log(`  Rolled back:      ${status.rolledBack}`);
  if (status.mostRecentApplied) {
    console.log(`  Last applied:     ${status.mostRecentApplied}`);
  }
  console.log('\n  By rule type:');
  for (const [type, count] of Object.entries(status.byRuleType)) {
    console.log(`    ${type.padEnd(25)} ${count}`);
  }
  console.log('');
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse options
// ─────────────────────────────────────────────────────────────────────────────

const dryRun = args.includes('--dry-run');
const skipTests = args.includes('--skip-tests');

const windowIdx = args.indexOf('--window');
const windowDays = windowIdx >= 0 ? parseInt(args[windowIdx + 1] ?? '30', 10) : 30;

const practiceIdx = args.indexOf('--practice');
const practiceId = practiceIdx >= 0 ? args[practiceIdx + 1] : undefined;

const maxApplyIdx = args.indexOf('--max-apply');
const maxAutoApply = maxApplyIdx >= 0 ? parseInt(args[maxApplyIdx + 1] ?? '5', 10) : 5;

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${CYAN}${BOLD}CollectRx Self-Tuning Agent${RESET}`);
console.log(`${DIM}  Window: ${windowDays} days | Dry run: ${dryRun} | Skip tests: ${skipTests}${RESET}\n`);

const prisma = new PrismaClient();

let dbReady = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
  console.log(`${GREEN}✓ Database connected${RESET}`);
} catch (err) {
  console.warn(`${YELLOW}⚠ Database unavailable — signals will be empty (analysis still runs on existing ledger)${RESET}`);
}

const { runSelfTuningCycle } = await import('../src/server/learning/selfTuner/index.js');

try {
  const summary = await runSelfTuningCycle(prisma, {
    windowDays,
    practiceId,
    skipTests,
    dryRun,
    maxAutoApply,
  });

  console.log(`\n${CYAN}${BOLD}Cycle Summary${RESET}`);
  console.log(`  Cycle ID:          ${summary.cycleId}`);
  console.log(`  Carriers analyzed: ${summary.carriersAnalyzed}`);
  console.log(`  Signals observed:  ${summary.signalsObserved}`);
  console.log(`  Proposals:         ${summary.proposalsGenerated}`);
  console.log(`  ${GREEN}Auto-applied:${RESET}      ${summary.proposalsAutoApplied}`);
  console.log(`  ${YELLOW}Pending review:${RESET}    ${summary.proposalsPendingReview}`);
  console.log(`  ${RED}Rejected:${RESET}          ${summary.proposalsRejected}`);

  if (summary.appliedChanges.length > 0) {
    console.log(`\n${GREEN}${BOLD}Applied Changes:${RESET}`);
    for (const change of summary.appliedChanges) {
      console.log(`  ${GREEN}✓${RESET} ${change}`);
    }
  }

  if (summary.pendingChanges.length > 0) {
    console.log(`\n${YELLOW}${BOLD}Pending Review (human approval needed):${RESET}`);
    for (const change of summary.pendingChanges) {
      console.log(`  ${YELLOW}⚑${RESET} ${change}`);
    }
  }

  if (summary.errors.length > 0) {
    console.log(`\n${RED}${BOLD}Errors:${RESET}`);
    for (const error of summary.errors) {
      console.log(`  ${RED}✗${RESET} ${error}`);
    }
  }

  const exitCode = summary.errors.length > 0 && summary.proposalsAutoApplied === 0 ? 1 : 0;
  console.log('');
  process.exit(exitCode);
} finally {
  await prisma.$disconnect().catch(() => undefined);
}
