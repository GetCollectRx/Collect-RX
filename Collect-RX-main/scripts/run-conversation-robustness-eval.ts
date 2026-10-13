/**
 * Run the conversation-robustness eval against the live prompts in
 * vapi-squad-config.json. Simulates carrier reps giving unexpected/
 * off-script responses and judges whether Claims_Agent / Escalation_Closer /
 * Resolution_Closer stays focused and reaches the correct outcome.
 *
 * Live LLM calls — requires ANTHROPIC_API_KEY and COLLECTRX_ANTHROPIC_EVAL=1.
 * Not part of `npm test`. Default: disabled to prevent accidental API spend.
 *
 * Usage:
 *   # Static validation only — no API key, no network, no cost:
 *   npm run eval:conversation-robustness -- --dry-run
 *
 *   # One scenario, default local repeat count (1):
 *   npm run eval:conversation-robustness -- bot_accusation
 *
 *   # All scenarios, recommended pre-merge repeat count (3):
 *   npm run eval:conversation-robustness -- --mode=recommended
 *
 *   # All scenarios, release-certification repeat count (5):
 *   npm run eval:conversation-robustness -- --mode=release
 *
 *   # Explicit repeat count overrides the mode preset:
 *   npm run eval:conversation-robustness -- --repeat=4
 *   COLLECTRX_EVAL_REPEAT=4 npm run eval:conversation-robustness
 *
 * Every non-dry-run invocation writes a timestamped JSON + Markdown report to
 * eval-output/ (gitignored). Compare two reports with:
 *   npm run eval:compare-reports -- eval-output/<baseline>.json eval-output/<candidate>.json
 */
import 'dotenv/config';
import { join } from 'path';
import {
  CONVERSATION_ROBUSTNESS_SCENARIOS,
  runConversationRobustnessEvalRepeated,
  validateScenarioLibrary,
  validateSilentAgentConfig,
  getAgentPrompt,
} from '../src/services/analytics/conversation-robustness-eval.js';
import { buildEvalReport, writeEvalReport, type RunMode } from '../src/services/analytics/conversation-robustness-report.js';

const OUT_DIR = join(process.cwd(), 'eval-output');

const REPEAT_PRESETS: Record<Exclude<RunMode, 'custom'>, number> = {
  local: 1,
  recommended: 3,
  release: 5,
};

function parseArgs(argv: string[]) {
  let dryRun = false;
  let mode: RunMode = 'local';
  let repeat: number | undefined;
  const scenarioIds: string[] = [];

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--mode=')) {
      const value = arg.slice('--mode='.length);
      if (value !== 'local' && value !== 'recommended' && value !== 'release') {
        throw new Error(`Unknown --mode value: ${value} (expected local|recommended|release)`);
      }
      mode = value;
    } else if (arg.startsWith('--repeat=')) {
      repeat = Number(arg.slice('--repeat='.length));
    } else if (!arg.startsWith('--')) {
      scenarioIds.push(arg);
    } else {
      throw new Error(`Unknown flag: ${arg}`);
    }
  }

  return { dryRun, mode, repeat, scenarioIds };
}

function runDryRun(): void {
  console.log('Running static validation (no API calls, no cost)...\n');

  const validation = validateScenarioLibrary();
  console.log(`Scenario library: ${validation.scenarioCount} scenarios`);
  if (validation.valid) {
    console.log('  All scenarios valid: unique ids, complete requirements, prompts render cleanly.\n');
  } else {
    console.log(`  ${validation.issues.length} issue(s) found:\n`);
    for (const issue of validation.issues) {
      console.log(`    [${issue.scenarioId}] ${issue.issue}`);
    }
    console.log('');
  }

  for (const agentName of ['Claims_Agent', 'Escalation_Closer', 'Resolution_Closer'] as const) {
    const prompt = getAgentPrompt(agentName);
    console.log(`${agentName}: model=${prompt.model}, temperature=${prompt.temperature}, prompt length=${prompt.systemPrompt.length}`);
  }
  console.log('');

  for (const agentName of ['IVR_Navigator', 'Hold_Sentinel'] as const) {
    const result = validateSilentAgentConfig(agentName);
    console.log(`${agentName} (silent/DTMF-only — structural check, not a conversational simulation):`);
    if (result.passed) {
      console.log('  OK');
    } else {
      for (const finding of result.findings) console.log(`  ISSUE: ${finding}`);
    }
  }
  console.log(
    '\nFull IVR/hold-queue behavior is not covered by this harness — see voice-agent-sim/STAGING-VALIDATION-PLAN.md for staging telephony validation.',
  );

  if (!validation.valid) process.exit(1);
}

async function main() {
  const { dryRun, mode, repeat, scenarioIds } = parseArgs(process.argv.slice(2));

  if (dryRun) {
    runDryRun();
    return;
  }

  const unknown = scenarioIds.filter((id) => !CONVERSATION_ROBUSTNESS_SCENARIOS.some((s) => s.id === id));
  if (unknown.length > 0) {
    console.error(`Unknown scenario id(s): ${unknown.join(', ')}`);
    console.error(`Available: ${CONVERSATION_ROBUSTNESS_SCENARIOS.map((s) => s.id).join(', ')}`);
    process.exit(1);
  }

  const envRepeat = process.env.COLLECTRX_EVAL_REPEAT ? Number(process.env.COLLECTRX_EVAL_REPEAT) : undefined;
  const repeatCount = repeat ?? envRepeat ?? REPEAT_PRESETS[mode];
  const runMode: RunMode = repeat !== undefined && repeat !== REPEAT_PRESETS[mode] ? 'custom' : mode;

  if (!Number.isInteger(repeatCount) || repeatCount < 1) {
    throw new Error(`Invalid repeat count: ${repeatCount}`);
  }

  console.log(`Running conversation-robustness eval — mode=${runMode}, repeat=${repeatCount}\n`);

  const scenariosRequested = scenarioIds.length ? scenarioIds : CONVERSATION_ROBUSTNESS_SCENARIOS.map((s) => s.id);
  const runs = await runConversationRobustnessEvalRepeated(scenarioIds.length ? scenarioIds : undefined, repeatCount);

  const byScenarioAndRep = new Map<string, typeof runs[number]>();
  for (const run of runs) byScenarioAndRep.set(`${run.scenarioId}#${run.repetitionNumber}`, run);

  for (const scenarioId of scenariosRequested) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`SCENARIO: ${scenarioId}`);
    console.log('='.repeat(70));
    for (let rep = 1; rep <= repeatCount; rep++) {
      const run = byScenarioAndRep.get(`${scenarioId}#${rep}`);
      if (!run) continue;
      console.log(`  Run ${rep}/${repeatCount}: ${run.passed ? 'PASS' : 'FAIL'}${run.failureReasons.length ? ` — ${run.failureReasons.join('; ')}` : ''}`);
    }
  }

  const firstRun = runs[0];
  const agentModel = firstRun ? getAgentPrompt('Claims_Agent').model : 'unknown';
  const report = buildEvalReport({
    runs,
    repeatCount,
    runMode,
    agentModel,
    judgeModel: 'claude-sonnet-4-6',
    scenariosRequested,
  });

  const { jsonPath, mdPath } = writeEvalReport(report, OUT_DIR);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`${report.summary.totalRuns} runs across ${report.summary.totalScenarios} scenario(s)`);
  console.log(`Overall pass rate: ${(report.summary.overallPassRate * 100).toFixed(1)}%`);
  console.log(`Critical-rule violations: ${report.summary.criticalViolationCount}`);
  console.log(`Flaky scenarios: ${report.summary.flakyScenarioIds.join(', ') || 'none'}`);
  if (repeatCount >= 5) {
    console.log(`Release-certified: ${report.summary.releaseCertifiedScenarioIds.length}/${report.summary.totalScenarios}`);
  } else {
    console.log('Release certification requires --mode=release (repeat=5) — not evaluated at this repeat count.');
  }
  console.log(`\nReport written to:\n  ${jsonPath}\n  ${mdPath}`);

  if (report.summary.overallPassRate < 1) process.exit(1);
}

main().catch((err) => {
  console.error('[eval:conversation-robustness]', (err as Error).message);
  process.exit(1);
});
