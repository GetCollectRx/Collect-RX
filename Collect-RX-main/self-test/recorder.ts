import { mkdirSync, writeFileSync } from 'node:fs';
import { expect } from '@playwright/test';

export type Status = 'PASS' | 'FAIL' | 'FINDING' | 'UNVERIFIED';

export interface Check {
  area: string;
  name: string;
  status: Status;
  evidence: string;
}

/**
 * Collects every check the self-test makes. A hard check that fails also fails
 * the Playwright test; an observation that does not hold is a FINDING, which is
 * reported but does not fail the run.
 */
export class Recorder {
  readonly checks: Check[] = [];

  record(area: string, name: string, status: Status, evidence: string): void {
    this.checks.push({ area, name, status, evidence });
  }

  /** A contract that must hold. `hard` makes a failure fail the test as well as the report. */
  expect(area: string, name: string, ok: boolean, evidence: string, hard = false): void {
    this.record(area, name, ok ? 'PASS' : 'FAIL', evidence);
    if (hard) expect.soft(ok, `${area}: ${name} (${evidence})`).toBe(true);
  }

  /** Something we want to know about but that is not a contract. */
  observe(area: string, name: string, ok: boolean, evidence: string): void {
    this.record(area, name, ok ? 'PASS' : 'FINDING', evidence);
  }

  write(dir: string): void {
    mkdirSync(`${dir}/artifacts`, { recursive: true });
    const count = (s: Status): number => this.checks.filter((c) => c.status === s).length;
    const lines: string[] = [
      '# CollectRx application self-test report',
      '',
      `Generated ${new Date().toISOString()}. All data is synthetic. Nothing left the machine: the app ran with an egress guard, the browser could not resolve outside hosts, and Vapi was a local fake.`,
      '',
      `**PASS ${count('PASS')}, FAIL ${count('FAIL')}, FINDING ${count('FINDING')}, UNVERIFIED ${count('UNVERIFIED')}**`,
      '',
    ];
    const problems = this.checks.filter((c) => c.status === 'FAIL' || c.status === 'FINDING');
    if (problems.length > 0) {
      lines.push('## Failures and findings', '', '| Status | Area | Check | Evidence |', '|---|---|---|---|');
      for (const c of problems) lines.push(`| ${c.status} | ${c.area} | ${c.name} | ${c.evidence.replace(/\|/gu, '/').replace(/\n/gu, ' ')} |`);
      lines.push('');
    }
    lines.push('## Every check', '', '| Status | Area | Check | Evidence |', '|---|---|---|---|');
    for (const c of this.checks) lines.push(`| ${c.status} | ${c.area} | ${c.name} | ${c.evidence.replace(/\|/gu, '/').replace(/\n/gu, ' ')} |`);
    writeFileSync(`${dir}/SELF-TEST-REPORT.md`, `${lines.join('\n')}\n`);
    writeFileSync(`${dir}/self-test-results.json`, JSON.stringify(this.checks, null, 2));
  }
}
