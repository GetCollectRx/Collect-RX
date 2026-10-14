#!/usr/bin/env node
/**
 * Policy lint. Fails CI on:
 *   1. Compliance, certification, residency or no-recording claims in docs,
 *      product copy, marketing templates and the PR template
 *      (rules in scripts/policy-lint-rules.json).
 *   2. Em dashes or en dashes in policy documents (docs/legal-policy).
 *
 * Existing claim violations outside the strict scope are grandfathered in
 * scripts/policy-lint-baseline.json so the gate can ship without a repo-wide
 * rewrite; new ones fail. The baseline only shrinks: entries that no longer
 * match are reported so they can be removed with --update-baseline.
 *
 * A line containing the allow marker (default "policy-lint-allow") is skipped,
 * for quoting a forbidden phrase on purpose; strict-scope files cannot use it.
 *
 * Usage (from repo root or Collect-RX-main):
 *   node Collect-RX-main/scripts/policy-lint.cjs
 *   node Collect-RX-main/scripts/policy-lint.cjs --update-baseline
 */
/* global require, module, process, __dirname */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS script run directly by node in CI */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const EM_DASH = '—';
const EN_DASH = '–';

/** Convert a glob with **, * and ? to a RegExp anchored on a posix path. */
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const slash = glob[i + 2] === '/';
        re += slash ? '(?:.*/)?' : '.*';
        i += slash ? 2 : 1;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('\\^$+.()|{}[]'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

function matchesAny(file, globs) {
  return globs.some((g) => globToRegExp(g).test(file));
}

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function lineKey(file, ruleId, line) {
  const norm = line.trim().replace(/\s+/g, ' ');
  return `${file}|${ruleId}|${crypto.createHash('sha256').update(norm).digest('hex').slice(0, 16)}`;
}

/**
 * Lint file contents. Pure function: `files` is [{ path, text }] with posix
 * paths relative to the repo root. Returns { violations, matchedBaseline }.
 */
function lintTexts(files, rules, baselineKeys = []) {
  const baseline = new Set(baselineKeys);
  const matchedBaseline = new Set();
  const violations = [];
  const claimRules = rules.forbiddenClaims.map((r) => ({ ...r, re: new RegExp(r.pattern, 'i') }));
  const marker = rules.allowMarker || 'policy-lint-allow';

  for (const { path: file, text } of files) {
    if (matchesAny(file, rules.excludePaths || [])) continue;
    const strictClaims = matchesAny(file, rules.strictClaimScope || []);
    const inClaimScope = strictClaims || matchesAny(file, rules.claimScope || []);
    const strictDashes = matchesAny(file, rules.strictDashScope || []);
    if (!inClaimScope && !strictDashes) continue;

    const lines = text.split(/\r?\n/);
    lines.forEach((line, idx) => {
      const allowed = !strictClaims && line.includes(marker);
      if (inClaimScope && !allowed) {
        for (const rule of claimRules) {
          if (!rule.re.test(line)) continue;
          const key = lineKey(file, rule.id, line);
          if (!strictClaims && baseline.has(key)) {
            matchedBaseline.add(key);
            continue;
          }
          violations.push({ file, line: idx + 1, rule: rule.id, message: rule.message, key });
        }
      }
      if (strictDashes && (line.includes(EM_DASH) || line.includes(EN_DASH))) {
        violations.push({
          file,
          line: idx + 1,
          rule: 'dash-in-policy-doc',
          message: 'Em dash or en dash in a policy document. Use a comma, colon, parentheses or "to".',
          key: lineKey(file, 'dash-in-policy-doc', line),
        });
      }
    });
  }
  return { violations, matchedBaseline: [...matchedBaseline] };
}

function findRepoRoot(start) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: start, encoding: 'utf8' }).trim();
  } catch {
    return path.resolve(start, '..', '..');
  }
}

function listTrackedFiles(root) {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter(Boolean);
}

function readFiles(root, rel, rules) {
  const candidates = rel.filter(
    (f) =>
      !matchesAny(f, rules.excludePaths || []) &&
      (matchesAny(f, rules.claimScope || []) ||
        matchesAny(f, rules.strictClaimScope || []) ||
        matchesAny(f, rules.strictDashScope || [])),
  );
  return candidates
    .filter((f) => fs.existsSync(path.join(root, f)))
    .map((f) => ({ path: f, text: fs.readFileSync(path.join(root, f), 'utf8') }));
}

function main(argv) {
  const scriptDir = __dirname;
  const root = findRepoRoot(scriptDir);
  const rules = loadJson(path.join(scriptDir, 'policy-lint-rules.json'), null);
  if (!rules) {
    process.stderr.write('policy-lint: rules file missing\n');
    return 2;
  }
  const baselinePath = path.join(scriptDir, 'policy-lint-baseline.json');
  const baselineDoc = loadJson(baselinePath, { entries: [] });
  const files = readFiles(root, listTrackedFiles(root), rules);

  if (argv.includes('--update-baseline')) {
    const { violations } = lintTexts(files, rules, []);
    const entries = violations
      .filter((v) => v.rule !== 'dash-in-policy-doc' && !matchesAny(v.file, rules.strictClaimScope || []))
      .map((v) => ({ key: v.key, file: v.file, rule: v.rule }));
    const unique = [...new Map(entries.map((e) => [e.key, e])).values()].sort((a, b) =>
      a.key.localeCompare(b.key),
    );
    fs.writeFileSync(
      baselinePath,
      `${JSON.stringify({ note: 'Grandfathered policy-lint findings. Remove entries as files are fixed; never add new ones by hand.', entries: unique }, null, 2)}\n`,
    );
    process.stdout.write(`policy-lint: baseline written with ${unique.length} entries\n`);
    return 0;
  }

  const baselineKeys = (baselineDoc.entries || []).map((e) => e.key);
  const { violations, matchedBaseline } = lintTexts(files, rules, baselineKeys);
  const stale = baselineKeys.filter((k) => !matchedBaseline.includes(k));
  if (stale.length > 0) {
    process.stdout.write(`policy-lint: ${stale.length} baseline entries no longer match; run with --update-baseline to drop them\n`);
  }
  if (violations.length === 0) {
    process.stdout.write(`policy-lint: OK (${files.length} files checked, ${matchedBaseline.length} grandfathered)\n`);
    return 0;
  }
  for (const v of violations) {
    process.stderr.write(`${v.file}:${v.line} [${v.rule}] ${v.message}\n`);
  }
  process.stderr.write(`policy-lint: ${violations.length} violation(s)\n`);
  return 1;
}

module.exports = { lintTexts, globToRegExp, matchesAny, lineKey };

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
