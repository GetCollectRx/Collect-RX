import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Violation {
  file: string;
  line: number;
  rule: string;
  key: string;
}
interface PolicyLint {
  lintTexts: (
    files: Array<{ path: string; text: string }>,
    rules: unknown,
    baselineKeys?: string[],
  ) => { violations: Violation[]; matchedBaseline: string[] };
  globToRegExp: (glob: string) => RegExp;
  lineKey: (file: string, ruleId: string, line: string) => string;
}

const require = createRequire(import.meta.url);
const lint = require('../scripts/policy-lint.cjs') as PolicyLint;
const rules: unknown = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'policy-lint-rules.json'), 'utf8'));

const EM = '—';
const EN = '–';

describe('policy lint rules', () => {
  it('flags a compliance claim in a markdown doc', () => {
    const { violations } = lint.lintTexts([{ path: 'docs/pitch.md', text: 'Our platform is PHIPA compliant.' }], rules);
    expect(violations.map((v) => v.rule)).toEqual(['compliance-claim']);
  });

  it('flags certification, residency and no-recording claims in product copy', () => {
    const text = ['Fully certified.', 'Your data stays in Canada.', 'Canadian data residency', 'We do not record calls.'].join('\n');
    const { violations } = lint.lintTexts([{ path: 'Collect-RX-main/src/pages/Landing.tsx', text }], rules);
    expect(violations.map((v) => v.rule)).toEqual([
      'certification-claim',
      'residency-claim',
      'residency-claim-2',
      'no-recording-claim',
    ]);
  });

  it('flags marketing templates and the PR template', () => {
    const { violations } = lint.lintTexts(
      [
        { path: 'Collect-RX-main/src/server/marketing/emailTemplates.ts', text: "subject: 'HIPAA compliant AR'" },
        { path: '.github/PULL_REQUEST_TEMPLATE.md', text: 'This change keeps us compliant.' },
      ],
      rules,
    );
    expect(violations).toHaveLength(2);
  });

  it('ignores server code outside the claim scope (EDI format terms)', () => {
    const { violations } = lint.lintTexts(
      [{ path: 'Collect-RX-main/src/server/pms/abeldentEdiVersionGuard.ts', text: '// X12 compliant envelope' }],
      rules,
    );
    expect(violations).toHaveLength(0);
  });

  it('ignores research analysis that quotes forbidden phrases', () => {
    const { violations } = lint.lintTexts(
      [{ path: 'research/2026-10-10-architecture/SYNTHESIS.md', text: 'Do not say "HIPAA compliant".' }],
      rules,
    );
    expect(violations).toHaveLength(0);
  });

  it('honours the allow marker outside the strict scope only', () => {
    const line = 'Never write "compliant" in copy. <!-- policy-lint-allow -->';
    const loose = lint.lintTexts([{ path: 'docs/guide.md', text: line }], rules);
    const strict = lint.lintTexts([{ path: 'Collect-RX-main/docs/legal-policy/09-x.md', text: line }], rules);
    expect(loose.violations).toHaveLength(0);
    expect(strict.violations.map((v) => v.rule)).toEqual(['compliance-claim']);
  });

  it('flags em and en dashes in policy documents but not elsewhere', () => {
    const text = `Purpose ${EM} scope\nPeriod 1${EN}2 years`;
    const policy = lint.lintTexts([{ path: 'Collect-RX-main/docs/legal-policy/01-privacy-notice.md', text }], rules);
    const other = lint.lintTexts([{ path: 'docs/operations/notes.md', text }], rules);
    expect(policy.violations.map((v) => v.rule)).toEqual(['dash-in-policy-doc', 'dash-in-policy-doc']);
    expect(other.violations).toHaveLength(0);
  });

  it('grandfathers baseline entries outside the strict scope and reports what matched', () => {
    const file = 'docs/old.md';
    const text = 'Legacy line: HIPAA compliant.';
    const key = lint.lineKey(file, 'compliance-claim', text);
    const result = lint.lintTexts([{ path: file, text }], rules, [key]);
    expect(result.violations).toHaveLength(0);
    expect(result.matchedBaseline).toEqual([key]);
  });

  it('never grandfathers findings in the strict scope', () => {
    const file = 'Collect-RX-main/docs/legal-policy/02-customer-agreement-addendum.md';
    const text = 'The service is certified.';
    const key = lint.lineKey(file, 'certification-claim', text);
    const result = lint.lintTexts([{ path: file, text }], rules, [key]);
    expect(result.violations).toHaveLength(1);
  });

  it('a changed line is a new finding even if the old line was grandfathered', () => {
    const file = 'docs/old.md';
    const key = lint.lineKey(file, 'compliance-claim', 'Legacy line: HIPAA compliant.');
    const result = lint.lintTexts([{ path: file, text: 'New line: PHIPA compliant.' }], rules, [key]);
    expect(result.violations).toHaveLength(1);
  });

  it('globToRegExp handles ** across directories and single-level *', () => {
    expect(lint.globToRegExp('**/*.md').test('a/b/c.md')).toBe(true);
    expect(lint.globToRegExp('**/*.md').test('c.md')).toBe(true);
    expect(lint.globToRegExp('src/pages/*.tsx').test('src/pages/a/b.tsx')).toBe(false);
  });
});
