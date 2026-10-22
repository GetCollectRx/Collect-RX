// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Conversation Robustness Eval: regression comparison
//
// Compares two eval reports (see conversation-robustness-report.ts) produced
// at different times/commits/prompt versions. A scenario is only compared
// apples-to-apples when its definition hash matches between the two reports
// — if the scenario's repTurns, expectation, varsOverride, or requirements
// changed, it is reported as a changed-definition scenario, never silently
// treated as equivalent.
// ─────────────────────────────────────────────────────────────────────────────

import type { EvalReport, ScenarioAggregate } from './conversation-robustness-report.js';

export interface PassRateChange {
  scenarioId: string;
  baselinePassRate: number;
  candidatePassRate: number;
  delta: number;
}

export interface ReportComparison {
  baseline: { generatedAt: string; gitCommit: string; gitBranch: string; runMode: string; repeatCount: number };
  candidate: { generatedAt: string; gitCommit: string; gitBranch: string; runMode: string; repeatCount: number };

  promptChanged: boolean;
  scenarioLibraryChanged: boolean;
  modelChanged: boolean;
  judgeModelChanged: boolean;

  newlyPassingScenarios: string[];
  newlyFailingScenarios: string[];
  newCriticalViolations: string[];
  resolvedCriticalViolations: string[];
  passRateChanges: PassRateChange[];
  increasedVariabilityScenarios: string[];

  /** Scenarios present in both reports but skipped from the diffs above because their definition changed. */
  scenariosWithChangedDefinition: string[];
  /** Scenarios only present in the candidate (newly added). */
  scenariosAddedInCandidate: string[];
  /** Scenarios only present in the baseline (removed or renamed). */
  scenariosRemovedInCandidate: string[];

  overallPassRateChange: { baseline: number; candidate: number; delta: number };
}

function byId(aggs: ScenarioAggregate[]): Map<string, ScenarioAggregate> {
  return new Map(aggs.map((a) => [a.scenarioId, a]));
}

export function compareReports(baseline: EvalReport, candidate: EvalReport): ReportComparison {
  const baseAggs = byId(baseline.scenarioAggregates);
  const candAggs = byId(candidate.scenarioAggregates);

  const allIds = new Set([...baseAggs.keys(), ...candAggs.keys()]);

  const scenariosAddedInCandidate: string[] = [];
  const scenariosRemovedInCandidate: string[] = [];
  const scenariosWithChangedDefinition: string[] = [];
  const newlyPassingScenarios: string[] = [];
  const newlyFailingScenarios: string[] = [];
  const newCriticalViolations: string[] = [];
  const resolvedCriticalViolations: string[] = [];
  const passRateChanges: PassRateChange[] = [];
  const increasedVariabilityScenarios: string[] = [];

  for (const id of allIds) {
    const base = baseAggs.get(id);
    const cand = candAggs.get(id);

    if (!base && cand) {
      scenariosAddedInCandidate.push(id);
      continue;
    }
    if (base && !cand) {
      scenariosRemovedInCandidate.push(id);
      continue;
    }
    if (!base || !cand) continue;

    if (base.scenarioDefinitionHash !== cand.scenarioDefinitionHash) {
      scenariosWithChangedDefinition.push(id);
      continue;
    }

    const basePassed = base.passRate === 1;
    const candPassed = cand.passRate === 1;
    if (!basePassed && candPassed) newlyPassingScenarios.push(id);
    if (basePassed && !candPassed) newlyFailingScenarios.push(id);

    if (!base.anyCriticalViolation && cand.anyCriticalViolation) newCriticalViolations.push(id);
    if (base.anyCriticalViolation && !cand.anyCriticalViolation) resolvedCriticalViolations.push(id);

    if (base.passRate !== cand.passRate) {
      passRateChanges.push({
        scenarioId: id,
        baselinePassRate: base.passRate,
        candidatePassRate: cand.passRate,
        delta: cand.passRate - base.passRate,
      });
    }

    // "Increased variability" = it was stable before (0% or 100%) and is now flaky, or it
    // was already flaky and got MORE flaky (further from either extreme).
    const baseDistanceFromExtreme = Math.min(base.passRate, 1 - base.passRate);
    const candDistanceFromExtreme = Math.min(cand.passRate, 1 - cand.passRate);
    if (candDistanceFromExtreme > baseDistanceFromExtreme) {
      increasedVariabilityScenarios.push(id);
    }
  }

  return {
    baseline: {
      generatedAt: baseline.generatedAt,
      gitCommit: baseline.gitCommit,
      gitBranch: baseline.gitBranch,
      runMode: baseline.runMode,
      repeatCount: baseline.repeatCount,
    },
    candidate: {
      generatedAt: candidate.generatedAt,
      gitCommit: candidate.gitCommit,
      gitBranch: candidate.gitBranch,
      runMode: candidate.runMode,
      repeatCount: candidate.repeatCount,
    },
    promptChanged: baseline.productionPromptHash !== candidate.productionPromptHash,
    scenarioLibraryChanged: baseline.scenarioLibraryHash !== candidate.scenarioLibraryHash,
    modelChanged: baseline.agentModel !== candidate.agentModel,
    judgeModelChanged: baseline.judgeModel !== candidate.judgeModel,
    newlyPassingScenarios,
    newlyFailingScenarios,
    newCriticalViolations,
    resolvedCriticalViolations,
    passRateChanges,
    increasedVariabilityScenarios,
    scenariosWithChangedDefinition,
    scenariosAddedInCandidate,
    scenariosRemovedInCandidate,
    overallPassRateChange: {
      baseline: baseline.summary.overallPassRate,
      candidate: candidate.summary.overallPassRate,
      delta: candidate.summary.overallPassRate - baseline.summary.overallPassRate,
    },
  };
}

export function renderComparisonMarkdown(comparison: ReportComparison): string {
  const lines: string[] = [];
  lines.push('# Conversation Robustness Eval — Regression Comparison');
  lines.push('');
  lines.push(`- **Baseline**: ${comparison.baseline.generatedAt} @ \`${comparison.baseline.gitCommit}\` (${comparison.baseline.gitBranch}, ${comparison.baseline.runMode}, repeat=${comparison.baseline.repeatCount})`);
  lines.push(`- **Candidate**: ${comparison.candidate.generatedAt} @ \`${comparison.candidate.gitCommit}\` (${comparison.candidate.gitBranch}, ${comparison.candidate.runMode}, repeat=${comparison.candidate.repeatCount})`);
  lines.push('');
  lines.push(`- Production prompt changed: ${comparison.promptChanged ? 'YES' : 'no'}`);
  lines.push(`- Scenario library changed: ${comparison.scenarioLibraryChanged ? 'YES' : 'no'}`);
  lines.push(`- Agent model changed: ${comparison.modelChanged ? 'YES' : 'no'}`);
  lines.push(`- Judge model changed: ${comparison.judgeModelChanged ? 'YES' : 'no'}`);
  lines.push(
    `- Overall pass rate: ${(comparison.overallPassRateChange.baseline * 100).toFixed(1)}% -> ${(comparison.overallPassRateChange.candidate * 100).toFixed(1)}% (${comparison.overallPassRateChange.delta >= 0 ? '+' : ''}${(comparison.overallPassRateChange.delta * 100).toFixed(1)}pp)`,
  );
  lines.push('');

  const section = (title: string, items: string[]) => {
    lines.push(`## ${title}`);
    lines.push('');
    if (items.length === 0) {
      lines.push('_(none)_');
    } else {
      for (const item of items) lines.push(`- ${item}`);
    }
    lines.push('');
  };

  section('Newly passing scenarios', comparison.newlyPassingScenarios);
  section('Newly failing scenarios', comparison.newlyFailingScenarios);
  section('New critical violations', comparison.newCriticalViolations);
  section('Resolved critical violations', comparison.resolvedCriticalViolations);
  section('Scenarios with increased variability', comparison.increasedVariabilityScenarios);
  section('Scenarios added in candidate', comparison.scenariosAddedInCandidate);
  section('Scenarios removed in candidate', comparison.scenariosRemovedInCandidate);
  section(
    'Scenarios excluded from comparison (definition changed — not treated as equivalent)',
    comparison.scenariosWithChangedDefinition,
  );

  lines.push('## Pass-rate changes');
  lines.push('');
  if (comparison.passRateChanges.length === 0) {
    lines.push('_(none)_');
  } else {
    lines.push('| Scenario | Baseline | Candidate | Delta |');
    lines.push('|---|---|---|---|');
    for (const c of comparison.passRateChanges) {
      lines.push(
        `| ${c.scenarioId} | ${(c.baselinePassRate * 100).toFixed(1)}% | ${(c.candidatePassRate * 100).toFixed(1)}% | ${c.delta >= 0 ? '+' : ''}${(c.delta * 100).toFixed(1)}pp |`,
      );
    }
  }
  lines.push('');

  return lines.join('\n');
}
