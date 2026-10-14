#!/usr/bin/env node
/**
 * Validates Collect-RX-main/docs/legal-policy/TRACEABILITY.md (L5).
 * Fails when a row references a policy document, control or test file that
 * does not exist, when an IMPLEMENTED row has no test path, when a PENDING_PR
 * row names no pull request, or when a tag, status, date or ID is malformed.
 *
 * Usage: node Collect-RX-main/scripts/check-traceability.cjs [path/to/TRACEABILITY.md]
 */
/* global require, module, process, __dirname */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS script run directly by node in CI */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STATUSES = ['IMPLEMENTED', 'PENDING_PR', 'PLANNED', 'NOT_BUILT', 'POLICY_ONLY'];
const TAGS = ['VERIFIED', 'EXCERPT', 'UNVERIFIED'];
const COLUMNS = [
  'ID',
  'Obligation',
  'Source',
  'Policy document',
  'Code control',
  'Test',
  'Evidence tag',
  'Owner',
  'Status',
  'Review date',
];

function splitRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
  return trimmed
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim());
}

function backtickedPaths(cell) {
  return [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter((p) => p.includes('/'));
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Pure check. `exists(relPath)` decides whether a repo-relative path exists.
 * Returns { rows, errors }.
 */
function checkMatrix(markdown, exists) {
  const errors = [];
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Matrix\s*$/.test(l.trim()));
  if (start < 0) return { rows: 0, errors: ['No "## Matrix" section found'] };

  let header = null;
  const seen = new Set();
  let rows = 0;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^##\s/.test(line.trim())) break;
    const cells = splitRow(line);
    if (!cells) continue;
    if (!header) {
      header = cells;
      if (COLUMNS.some((c, idx) => header[idx] !== c)) {
        errors.push(`Header must be: ${COLUMNS.join(' | ')}`);
        return { rows, errors };
      }
      continue;
    }
    if (cells.every((c) => /^-+$/.test(c))) continue;
    rows += 1;
    const where = `line ${i + 1}`;
    if (cells.length !== COLUMNS.length) {
      errors.push(`${where}: expected ${COLUMNS.length} cells, found ${cells.length}`);
      continue;
    }
    const [id, , , policyDoc, control, test, tag, owner, status, review] = cells;
    if (!/^T\d{2,}$/.test(id)) errors.push(`${where}: bad ID "${id}"`);
    if (seen.has(id)) errors.push(`${where}: duplicate ID ${id}`);
    seen.add(id);
    if (!STATUSES.includes(status)) errors.push(`${where} (${id}): status "${status}" not in ${STATUSES.join(', ')}`);
    if (!TAGS.some((t) => tag === t || tag.startsWith(`${t} (`))) errors.push(`${where} (${id}): evidence tag "${tag}" invalid`);
    if (!owner) errors.push(`${where} (${id}): owner missing`);
    if (!isValidDate(review)) errors.push(`${where} (${id}): review date "${review}" is not YYYY-MM-DD`);

    const docs = backtickedPaths(policyDoc);
    if (docs.length === 0) errors.push(`${where} (${id}): policy document must be a backticked path`);
    for (const p of docs) if (!exists(p)) errors.push(`${where} (${id}): policy document not found: ${p}`);

    if (status === 'IMPLEMENTED') {
      const controlPaths = backtickedPaths(control);
      const testPaths = backtickedPaths(test);
      if (controlPaths.length === 0) errors.push(`${where} (${id}): IMPLEMENTED row needs a backticked control path`);
      if (testPaths.length === 0) errors.push(`${where} (${id}): IMPLEMENTED row needs a backticked test path`);
      for (const p of [...controlPaths, ...testPaths]) {
        if (!exists(p)) errors.push(`${where} (${id}): file not found: ${p}`);
      }
    }
    if (status === 'PENDING_PR' && !/#\d+/.test(`${control} ${test}`)) {
      errors.push(`${where} (${id}): PENDING_PR row must name a pull request (#123)`);
    }
  }
  if (!header) errors.push('Matrix table not found under "## Matrix"');
  if (rows === 0) errors.push('Matrix has no rows');
  return { rows, errors };
}

function main(argv) {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const file = argv[0]
    ? path.resolve(argv[0])
    : path.join(repoRoot, 'Collect-RX-main', 'docs', 'legal-policy', 'TRACEABILITY.md');
  if (!fs.existsSync(file)) {
    process.stderr.write(`check-traceability: ${file} not found\n`);
    return 1;
  }
  const { rows, errors } = checkMatrix(fs.readFileSync(file, 'utf8'), (p) =>
    fs.existsSync(path.join(repoRoot, p)),
  );
  if (errors.length > 0) {
    for (const e of errors) process.stderr.write(`TRACEABILITY.md ${e}\n`);
    process.stderr.write(`check-traceability: FAILED with ${errors.length} error(s)\n`);
    return 1;
  }
  process.stdout.write(`check-traceability: OK (${rows} rows)\n`);
  return 0;
}

module.exports = { checkMatrix, backtickedPaths, isValidDate };

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
