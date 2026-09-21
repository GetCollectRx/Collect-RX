/**
 * Compare two conversation-robustness eval reports (JSON files written by
 * run-conversation-robustness-eval.ts to eval-output/).
 *
 * Fully offline — reads two local JSON files, no API key or network needed.
 *
 * Usage:
 *   npm run eval:compare-reports -- eval-output/<baseline>.json eval-output/<candidate>.json
 */
import { readFileSync, writeFileSync } from 'fs';
import type { EvalReport } from '../src/services/analytics/conversation-robustness-report.js';
import { compareReports, renderComparisonMarkdown } from '../src/services/analytics/conversation-robustness-compare.js';

function loadReport(path: string): EvalReport {
  return JSON.parse(readFileSync(path, 'utf-8')) as EvalReport;
}

function main() {
  const [baselinePath, candidatePath] = process.argv.slice(2);
  if (!baselinePath || !candidatePath) {
    console.error('Usage: eval:compare-reports -- <baseline.json> <candidate.json>');
    process.exit(1);
  }

  const baseline = loadReport(baselinePath);
  const candidate = loadReport(candidatePath);
  const comparison = compareReports(baseline, candidate);
  const markdown = renderComparisonMarkdown(comparison);

  console.log(markdown);

  const outPath = candidatePath.replace(/\.json$/, '.comparison.md');
  writeFileSync(outPath, markdown, 'utf-8');
  console.log(`\nComparison written to: ${outPath}`);

  if (comparison.newCriticalViolations.length > 0 || comparison.newlyFailingScenarios.length > 0) {
    process.exit(1);
  }
}

main();
