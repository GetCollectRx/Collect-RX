import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Checker {
  checkMatrix: (markdown: string, exists: (p: string) => boolean) => { rows: number; errors: string[] };
  isValidDate: (v: string) => boolean;
}

const require = createRequire(import.meta.url);
const checker = require('../scripts/check-traceability.cjs') as Checker;
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

const HEADER =
  '| ID | Obligation | Source | Policy document | Code control | Test | Evidence tag | Owner | Status | Review date |\n|---|---|---|---|---|---|---|---|---|---|';

function matrix(...rows: string[]): string {
  return `# T\n\n## Matrix\n\n${HEADER}\n${rows.join('\n')}\n`;
}

const present = new Set(['docs/p.md', 'src/c.ts', 'tests/c.test.ts']);
const exists = (p: string) => present.has(p);

describe('checkMatrix', () => {
  it('accepts a valid IMPLEMENTED row', () => {
    const md = matrix('| T01 | O | S | `docs/p.md` | `src/c.ts` | `tests/c.test.ts` | VERIFIED | Eng | IMPLEMENTED | 2027-01-31 |');
    expect(checker.checkMatrix(md, exists)).toEqual({ rows: 1, errors: [] });
  });

  it('fails loudly when an IMPLEMENTED row references a missing test file', () => {
    const md = matrix('| T01 | O | S | `docs/p.md` | `src/c.ts` | `tests/gone.test.ts` | VERIFIED | Eng | IMPLEMENTED | 2027-01-31 |');
    const { errors } = checker.checkMatrix(md, exists);
    expect(errors).toEqual([expect.stringContaining('file not found: tests/gone.test.ts')]);
  });

  it('fails when an IMPLEMENTED row has no test path', () => {
    const md = matrix('| T01 | O | S | `docs/p.md` | `src/c.ts` | none yet | VERIFIED | Eng | IMPLEMENTED | 2027-01-31 |');
    expect(checker.checkMatrix(md, exists).errors).toEqual([expect.stringContaining('needs a backticked test path')]);
  });

  it('fails when the policy document is missing, for any status', () => {
    const md = matrix('| T01 | O | S | `docs/missing.md` | x | y | VERIFIED | Eng | PLANNED | 2027-01-31 |');
    expect(checker.checkMatrix(md, exists).errors).toEqual([expect.stringContaining('policy document not found')]);
  });

  it('requires a PR number on PENDING_PR rows', () => {
    const ok = matrix('| T01 | O | S | `docs/p.md` | gate in PR #130 | test in PR #130 | VERIFIED | Eng | PENDING_PR | 2027-01-31 |');
    const bad = matrix('| T01 | O | S | `docs/p.md` | gate | test | VERIFIED | Eng | PENDING_PR | 2027-01-31 |');
    expect(checker.checkMatrix(ok, exists).errors).toEqual([]);
    expect(checker.checkMatrix(bad, exists).errors).toEqual([expect.stringContaining('must name a pull request')]);
  });

  it('rejects bad status, tag, date and duplicate IDs', () => {
    const md = matrix(
      '| T01 | O | S | `docs/p.md` | x | y | MAYBE | Eng | DONE | 2027-02-30 |',
      '| T01 | O | S | `docs/p.md` | x | y | VERIFIED | Eng | PLANNED | 2027-01-31 |',
    );
    const { errors } = checker.checkMatrix(md, exists);
    expect(errors.some((e) => e.includes('status "DONE"'))).toBe(true);
    expect(errors.some((e) => e.includes('evidence tag "MAYBE"'))).toBe(true);
    expect(errors.some((e) => e.includes('review date "2027-02-30"'))).toBe(true);
    expect(errors.some((e) => e.includes('duplicate ID T01'))).toBe(true);
  });

  it('accepts qualified tags such as "VERIFIED (text)"', () => {
    const md = matrix('| T01 | O | S | `docs/p.md` | x | y | VERIFIED (text); open | Eng | PLANNED | 2027-01-31 |');
    expect(checker.checkMatrix(md, exists).errors).toEqual([]);
  });

  it('fails without a Matrix section or with a wrong header', () => {
    expect(checker.checkMatrix('# nothing', exists).errors).toEqual(['No "## Matrix" section found']);
    const wrong = '## Matrix\n\n| ID | Obligation |\n|---|---|\n| T01 | O |\n';
    expect(checker.checkMatrix(wrong, exists).errors[0]).toContain('Header must be');
  });
});

describe('the committed TRACEABILITY.md', () => {
  it('passes the check against the real repository tree', () => {
    const file = join(repoRoot, 'Collect-RX-main', 'docs', 'legal-policy', 'TRACEABILITY.md');
    const { rows, errors } = checker.checkMatrix(readFileSync(file, 'utf8'), (p) => existsSync(join(repoRoot, p)));
    expect(errors).toEqual([]);
    expect(rows).toBeGreaterThan(20);
  });
});
