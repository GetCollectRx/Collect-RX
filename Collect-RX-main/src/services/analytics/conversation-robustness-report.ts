// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Conversation Robustness Eval: auditable report generation
//
// Builds a timestamped, reviewable record of an eval run: every individual
// repetition, deterministic-check results, judge output, the combined
// pass/fail, git/model/prompt/scenario provenance hashes, summary metrics,
// flaky-scenario detection, and an empty human-review section a reviewer
// fills in by hand. Writes JSON (machine-readable, feeds report comparison)
// and Markdown (human-readable) to an eval-output directory.
//
// Never include real patient information, API keys, or secrets in a report —
// every fixture used by this harness is synthetic (see
// conversation-robustness-eval.ts), so this holds by construction as long as
// no one adds live PHI to the fixture data.
// ─────────────────────────────────────────────────────────────────────────────

import { execSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  CONVERSATION_ROBUSTNESS_SCENARIOS,
  SYNTHETIC_FIXTURE_VERSION,
  computeProductionPromptHash,
  computeScenarioDefinitionHash,
  computeScenarioLibraryHash,
  type RepeatedRunResult,
  type RobustnessScenario,
} from './conversation-robustness-eval.js';

export type RunMode = 'local' | 'recommended' | 'release' | 'custom';

export interface HumanReviewEntry {
  scenarioId: string;
  repetitionNumber: number;
  reviewerAgreement: 'agree' | 'disagree' | null;
  correctExpectedResult: string | null;
  reviewerNotes: string | null;
  falsePositive: boolean | null;
  falseNegative: boolean | null;
  promptDefect: boolean | null;
  scenarioDefect: boolean | null;
  productDefect: boolean | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export interface RunRecord {
  scenarioId: string;
  scenarioVersion: number;
  scenarioDefinitionHash: string;
  repetitionNumber: number;
  agentUnderTest: string;
  carrier: string;
  criticality: string;
  conversation: RepeatedRunResult['conversation'];
  deterministic: RepeatedRunResult['deterministic'];
  judgment: RepeatedRunResult['judgment'];
  passed: boolean;
  failureReasons: string[];
}

export interface ScenarioAggregate {
  scenarioId: string;
  label: string;
  agentUnderTest: string;
  carrier: string;
  criticality: string;
  scenarioDefinitionHash: string;
  repeatCount: number;
  passCount: number;
  passRate: number;
  flaky: boolean;
  anyCriticalViolation: boolean;
  releaseCertified: boolean;
  failureReasonsUnion: string[];
}

export interface EvalReport {
  reportVersion: 3;
  generatedAt: string;
  gitCommit: string;
  gitBranch: string;
  runMode: RunMode;
  repeatCount: number;
  agentModel: string;
  judgeModel: string;
  productionPromptHash: string;
  scenarioLibraryHash: string;
  syntheticFixtureVersion: string;
  scenariosRequested: string[];
  runs: RunRecord[];
  scenarioAggregates: ScenarioAggregate[];
  summary: {
    totalScenarios: number;
    totalRuns: number;
    overallPassRate: number;
    criticalViolationCount: number;
    flakyScenarioIds: string[];
    releaseCertifiedScenarioIds: string[];
    notReleaseCertifiedScenarioIds: string[];
  };
  humanReview: HumanReviewEntry[];
}

function safeGit(command: string): string {
  try {
    return execSync(command, { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

function scenarioById(scenarioId: string): RobustnessScenario | undefined {
  return CONVERSATION_ROBUSTNESS_SCENARIOS.find((s) => s.id === scenarioId);
}

/**
 * A scenario is release-certified only if it ran at least 5 times and no
 * repetition produced a critical violation and every repetition passed.
 * Fewer than 5 repetitions can never certify — certification is a claim
 * about reliability across repeated runs, not a single lucky pass.
 */
const RELEASE_CERTIFICATION_MIN_REPEATS = 5;

export function buildEvalReport(params: {
  runs: RepeatedRunResult[];
  repeatCount: number;
  runMode: RunMode;
  agentModel: string;
  judgeModel: string;
  scenariosRequested: string[];
}): EvalReport {
  const { runs, repeatCount, runMode, agentModel, judgeModel, scenariosRequested } = params;

  const runRecords: RunRecord[] = runs.map((r) => {
    const scenario = scenarioById(r.scenarioId);
    return {
      scenarioId: r.scenarioId,
      scenarioVersion: scenario?.requirements.version ?? 0,
      scenarioDefinitionHash: scenario ? computeScenarioDefinitionHash(scenario) : 'unknown',
      repetitionNumber: r.repetitionNumber,
      agentUnderTest: scenario?.requirements.agentUnderTest ?? 'unknown',
      carrier: scenario?.requirements.carrier ?? 'unknown',
      criticality: scenario?.requirements.criticality ?? 'unknown',
      conversation: r.conversation,
      deterministic: r.deterministic,
      judgment: r.judgment,
      passed: r.passed,
      failureReasons: r.failureReasons,
    };
  });

  const scenarioIds = [...new Set(runRecords.map((r) => r.scenarioId))];
  const scenarioAggregates: ScenarioAggregate[] = scenarioIds.map((scenarioId) => {
    const scenario = scenarioById(scenarioId);
    const scenarioRuns = runRecords.filter((r) => r.scenarioId === scenarioId);
    const passCount = scenarioRuns.filter((r) => r.passed).length;
    const passRate = scenarioRuns.length > 0 ? passCount / scenarioRuns.length : 0;
    const anyCriticalViolation = scenarioRuns.some((r) => r.deterministic.criticalViolation || r.judgment.brokeCriticalRule);
    const flaky = passCount > 0 && passCount < scenarioRuns.length;
    const releaseCertified =
      scenarioRuns.length >= RELEASE_CERTIFICATION_MIN_REPEATS && !anyCriticalViolation && passCount === scenarioRuns.length;

    return {
      scenarioId,
      label: scenario?.label ?? scenarioId,
      agentUnderTest: scenario?.requirements.agentUnderTest ?? 'unknown',
      carrier: scenario?.requirements.carrier ?? 'unknown',
      criticality: scenario?.requirements.criticality ?? 'unknown',
      scenarioDefinitionHash: scenario ? computeScenarioDefinitionHash(scenario) : 'unknown',
      repeatCount: scenarioRuns.length,
      passCount,
      passRate,
      flaky,
      anyCriticalViolation,
      releaseCertified,
      failureReasonsUnion: [...new Set(scenarioRuns.flatMap((r) => r.failureReasons))],
    };
  });

  const totalRuns = runRecords.length;
  const overallPassRate = totalRuns > 0 ? runRecords.filter((r) => r.passed).length / totalRuns : 0;
  const criticalViolationCount = runRecords.filter((r) => r.deterministic.criticalViolation || r.judgment.brokeCriticalRule).length;

  const humanReview: HumanReviewEntry[] = runRecords.map((r) => ({
    scenarioId: r.scenarioId,
    repetitionNumber: r.repetitionNumber,
    reviewerAgreement: null,
    correctExpectedResult: null,
    reviewerNotes: null,
    falsePositive: null,
    falseNegative: null,
    promptDefect: null,
    scenarioDefect: null,
    productDefect: null,
    reviewedBy: null,
    reviewedAt: null,
  }));

  return {
    reportVersion: 3,
    generatedAt: new Date().toISOString(),
    gitCommit: safeGit('git rev-parse HEAD'),
    gitBranch: safeGit('git rev-parse --abbrev-ref HEAD'),
    runMode,
    repeatCount,
    agentModel,
    judgeModel,
    productionPromptHash: computeProductionPromptHash(),
    scenarioLibraryHash: computeScenarioLibraryHash(),
    syntheticFixtureVersion: SYNTHETIC_FIXTURE_VERSION,
    scenariosRequested,
    runs: runRecords,
    scenarioAggregates,
    summary: {
      totalScenarios: scenarioIds.length,
      totalRuns,
      overallPassRate,
      criticalViolationCount,
      flakyScenarioIds: scenarioAggregates.filter((s) => s.flaky).map((s) => s.scenarioId),
      releaseCertifiedScenarioIds: scenarioAggregates.filter((s) => s.releaseCertified).map((s) => s.scenarioId),
      notReleaseCertifiedScenarioIds: scenarioAggregates.filter((s) => !s.releaseCertified).map((s) => s.scenarioId),
    },
    humanReview,
  };
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function renderMarkdownReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(`# Conversation Robustness Eval Report`);
  lines.push('');
  lines.push(`- **Generated**: ${report.generatedAt}`);
  lines.push(`- **Git commit**: \`${report.gitCommit}\``);
  lines.push(`- **Git branch**: \`${report.gitBranch}\``);
  lines.push(`- **Run mode**: ${report.runMode} (repeat count: ${report.repeatCount})`);
  lines.push(`- **Agent model**: ${report.agentModel}`);
  lines.push(`- **Judge model**: ${report.judgeModel}`);
  lines.push(`- **Production prompt hash**: \`${report.productionPromptHash}\``);
  lines.push(`- **Scenario library hash**: \`${report.scenarioLibraryHash}\``);
  lines.push(`- **Synthetic fixture version**: ${report.syntheticFixtureVersion}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Scenarios run: ${report.summary.totalScenarios}`);
  lines.push(`- Total individual runs: ${report.summary.totalRuns}`);
  lines.push(`- Overall pass rate: ${pct(report.summary.overallPassRate)}`);
  lines.push(`- Critical-rule violations (individual runs): ${report.summary.criticalViolationCount}`);
  lines.push(`- Flaky scenarios (pass some runs, fail others): ${report.summary.flakyScenarioIds.length}`);
  lines.push(`- Release-certified scenarios: ${report.summary.releaseCertifiedScenarioIds.length}`);
  lines.push(`- Not release-certified: ${report.summary.notReleaseCertifiedScenarioIds.length}`);
  if (report.repeatCount < 5) {
    lines.push('');
    lines.push(
      `> Repeat count is ${report.repeatCount}. No scenario in this report can be release-certified — certification requires at least 5 repetitions with zero critical violations and a 100% pass rate (\`--mode=release\` or \`COLLECTRX_EVAL_REPEAT=5\`).`,
    );
  }
  lines.push('');

  if (report.summary.flakyScenarioIds.length > 0) {
    lines.push('## Flaky scenarios');
    lines.push('');
    lines.push('| Scenario | Pass rate | Runs | Critical violation? |');
    lines.push('|---|---|---|---|');
    for (const id of report.summary.flakyScenarioIds) {
      const agg = report.scenarioAggregates.find((s) => s.scenarioId === id);
      if (!agg) continue;
      lines.push(`| ${agg.label} (\`${id}\`) | ${pct(agg.passRate)} | ${agg.repeatCount} | ${agg.anyCriticalViolation ? 'YES' : 'no'} |`);
    }
    lines.push('');
  }

  lines.push('## Scenario results');
  lines.push('');
  lines.push('| Scenario | Agent | Carrier | Criticality | Pass rate | Certified | Failure reasons |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const agg of report.scenarioAggregates) {
    const reasons = agg.failureReasonsUnion.length ? agg.failureReasonsUnion.join('; ') : '—';
    lines.push(
      `| ${agg.label} (\`${agg.scenarioId}\`) | ${agg.agentUnderTest} | ${agg.carrier} | ${agg.criticality} | ${pct(agg.passRate)} (${agg.passCount}/${agg.repeatCount}) | ${agg.releaseCertified ? 'YES' : 'no'} | ${reasons} |`,
    );
  }
  lines.push('');

  lines.push('## Human review');
  lines.push('');
  lines.push(
    'The automated judge is not the source of truth. A human reviewer should fill in agreement/disagreement, the correct expected result, and defect classification (false positive/negative, prompt defect, scenario defect, product defect) for any scenario worth a second look — start with critical violations and anything not release-certified. See the `humanReview` array in the JSON report for the editable schema; this table is a starting checklist, not a form to fill in this file.',
  );
  lines.push('');
  lines.push('| Scenario | Rep # | Passed | Reviewer agreement | Notes |');
  lines.push('|---|---|---|---|---|');
  const toReview = report.runs.filter((r) => !r.passed || r.deterministic.criticalViolation);
  for (const r of toReview.slice(0, 50)) {
    lines.push(`| ${r.scenarioId} | ${r.repetitionNumber} | ${r.passed ? 'yes' : 'NO'} | _(fill in)_ | _(fill in)_ |`);
  }
  if (toReview.length === 0) {
    lines.push('| _(none — every run passed with no critical violations)_ | | | | |');
  }
  lines.push('');

  return lines.join('\n');
}

export function writeEvalReport(report: EvalReport, outDir: string): { jsonPath: string; mdPath: string } {
  mkdirSync(outDir, { recursive: true });
  const timestamp = report.generatedAt.replace(/[:.]/g, '-');
  const base = `conversation-robustness-${timestamp}-${report.runMode}`;
  const jsonPath = join(outDir, `${base}.json`);
  const mdPath = join(outDir, `${base}.md`);

  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
  writeFileSync(mdPath, renderMarkdownReport(report), 'utf-8');

  return { jsonPath, mdPath };
}
