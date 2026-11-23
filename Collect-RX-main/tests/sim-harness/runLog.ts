/**
 * Stage 1 run log.
 *
 * Rule 7 of the harness brief: a claim without a log line did not happen.
 * Every check is recorded with a status and its evidence, written as JSON
 * lines while the run progresses, and rendered into a Markdown report at
 * the end. Product checks never throw: a FAIL is recorded and the run
 * continues, so one broken step cannot hide the results of the steps after
 * it. The run verdict is FAIL if any product check failed.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type CheckStatus = 'PASS' | 'FAIL' | 'UNVERIFIED' | 'FINDING';

export interface CheckRecord {
  seq: number;
  at: string;
  step: string;
  components: string;
  check: string;
  status: CheckStatus;
  evidence: string;
}

export interface ScenarioRecord {
  scenario: string;
  persona: string;
  carrierId: string;
  expected: string;
  observed: string;
  status: CheckStatus;
}

export class RunLog {
  readonly runId: string;
  readonly dir: string;
  readonly checks: CheckRecord[] = [];
  readonly scenarios: ScenarioRecord[] = [];
  readonly notes: string[] = [];
  private seq = 0;
  private readonly jsonlPath: string;

  constructor(runId: string, baseDir = process.env.SIM_RUN_DIR || path.join(os.tmpdir(), 'crx-sim-runs')) {
    this.runId = runId;
    this.dir = path.join(baseDir, runId);
    mkdirSync(this.dir, { recursive: true });
    this.jsonlPath = path.join(this.dir, 'run-log.jsonl');
    writeFileSync(this.jsonlPath, '');
  }

  record(step: string, components: string, check: string, status: CheckStatus, evidence: string): void {
    this.seq += 1;
    const entry: CheckRecord = { seq: this.seq, at: new Date().toISOString(), step, components, check, status, evidence };
    this.checks.push(entry);
    appendFileSync(this.jsonlPath, `${JSON.stringify(entry)}\n`);
  }

  /** Records PASS when the condition holds, FAIL otherwise. Never throws. */
  expect(step: string, components: string, check: string, condition: boolean, evidence: string): boolean {
    this.record(step, components, check, condition ? 'PASS' : 'FAIL', evidence);
    return condition;
  }

  scenario(entry: ScenarioRecord): void {
    this.scenarios.push(entry);
    appendFileSync(this.jsonlPath, `${JSON.stringify({ kind: 'scenario', ...entry })}\n`);
  }

  note(text: string): void {
    this.notes.push(text);
    appendFileSync(this.jsonlPath, `${JSON.stringify({ kind: 'note', text })}\n`);
  }

  count(status: CheckStatus): number {
    return this.checks.filter((c) => c.status === status).length;
  }

  verdict(): 'PASS' | 'FAIL' {
    const scenarioFail = this.scenarios.some((s) => s.status === 'FAIL');
    return this.count('FAIL') > 0 || scenarioFail ? 'FAIL' : 'PASS';
  }

  writeReport(): string {
    const cell = (s: string): string => s.replace(/\|/gu, '/').replace(/\n/gu, ' ');
    const lines: string[] = [
      `# Simulation harness Stage 1 run ${this.runId}`,
      '',
      `Verdict: **${this.verdict()}** (PASS ${this.count('PASS')}, FAIL ${this.count('FAIL')}, UNVERIFIED ${this.count('UNVERIFIED')}, FINDING ${this.count('FINDING')})`,
      '',
      '## Checks',
      '',
      '| # | Step | Components | Check | Status | Evidence |',
      '|---|---|---|---|---|---|',
      ...this.checks.map((c) => `| ${c.seq} | ${cell(c.step)} | ${cell(c.components)} | ${cell(c.check)} | ${c.status} | ${cell(c.evidence)} |`),
      '',
      '## Scenarios',
      '',
      '| Scenario | Persona | Carrier | Expected | Observed | Status |',
      '|---|---|---|---|---|---|',
      ...this.scenarios.map((s) => `| ${cell(s.scenario)} | ${cell(s.persona)} | ${s.carrierId} | ${cell(s.expected)} | ${cell(s.observed)} | ${s.status} |`),
      '',
      '## Notes',
      '',
      ...this.notes.map((n) => `- ${n}`),
      '',
    ];
    const reportPath = path.join(this.dir, 'REPORT.md');
    writeFileSync(reportPath, lines.join('\n'));
    return reportPath;
  }
}
