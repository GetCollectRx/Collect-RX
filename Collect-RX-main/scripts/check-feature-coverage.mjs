#!/usr/bin/env node
/**
 * Feature coverage gate. Reads test-coverage/feature-registry.json and fails when:
 *   - a source file under src/ belongs to no feature (new code must be claimed),
 *   - a feature lists no test file that exists,
 *   - a feature's line coverage is below its floor (needs a coverage summary).
 *
 * Usage:
 *   node scripts/check-feature-coverage.mjs                         # mapping + tests only
 *   node scripts/check-feature-coverage.mjs --coverage <summary.json>
 *   node scripts/check-feature-coverage.mjs --coverage <summary.json> --raise-floors
 *
 * --raise-floors only ever raises a floor, to one point below the current
 * whole-number coverage: coverage varies slightly between machines, and a
 * floor set at exactly the local figure fails in CI. It never lowers one.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const REGISTRY_PATH = join(ROOT, 'test-coverage', 'feature-registry.json');
const ENVIRONMENT_TOLERANCE_POINTS = 1;

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i++;
      if (glob[i + 1] === '/') i++;
    } else if (c === '*') {
      re += '[^/]*';
    } else if ('.+?^${}()|[]\\'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(relative(ROOT, full));
  }
  return out;
}

export function assignFiles(registry, files) {
  const excluded = registry.excluded.patterns.map(globToRegExp);
  const features = registry.features.map((f) => ({ ...f, srcRe: f.src.map(globToRegExp) }));
  const owner = new Map();
  const unmapped = [];
  for (const file of files) {
    if (!/\.(ts|tsx|js|mjs|cjs)$/.test(file)) continue;
    if (excluded.some((re) => re.test(file))) continue;
    const feature = features.find((f) => f.srcRe.some((re) => re.test(file)));
    if (feature) owner.set(file, feature.id);
    else unmapped.push(file);
  }
  return { owner, unmapped };
}

export function testsFor(feature, allFiles) {
  const res = feature.tests.map(globToRegExp);
  return allFiles.filter((f) => res.some((re) => re.test(f)));
}

export function featureCoverage(registry, owner, summary) {
  const totals = new Map(registry.features.map((f) => [f.id, { covered: 0, total: 0 }]));
  for (const [abs, entry] of Object.entries(summary)) {
    if (abs === 'total') continue;
    const rel = abs.includes('/src/') ? `src/${abs.split('/src/').slice(1).join('/src/')}` : abs;
    const id = owner.get(rel);
    if (!id) continue;
    const t = totals.get(id);
    t.covered += entry.lines.covered;
    t.total += entry.lines.total;
  }
  return totals;
}

function main() {
  const args = process.argv.slice(2);
  const coverageIdx = args.indexOf('--coverage');
  const summaryPath = coverageIdx >= 0 ? args[coverageIdx + 1] : null;
  const raise = args.includes('--raise-floors');

  const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
  const srcFiles = walk(join(ROOT, 'src'));
  const testFiles = [...srcFiles, ...walk(join(ROOT, 'tests')), ...walk(join(ROOT, 'e2e'))];
  const problems = [];

  const { owner, unmapped } = assignFiles(registry, srcFiles);
  for (const file of unmapped) problems.push(`unmapped source file (add it to a feature): ${file}`);

  for (const feature of registry.features) {
    if (testsFor(feature, testFiles).length === 0) problems.push(`feature "${feature.id}" has no existing test file`);
  }

  if (summaryPath) {
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
    const totals = featureCoverage(registry, owner, summary);
    const rows = [];
    for (const feature of registry.features) {
      const { covered, total } = totals.get(feature.id);
      const pct = total === 0 ? 100 : (100 * covered) / total;
      rows.push({ feature: feature.id, lines: total, coveredPct: Number(pct.toFixed(1)), floor: feature.floor });
      if (pct + 1e-9 < feature.floor) {
        problems.push(`feature "${feature.id}" line coverage ${pct.toFixed(1)}% is below its floor ${feature.floor}%`);
      }
      if (raise) feature.floor = Math.max(feature.floor, Math.floor(pct) - ENVIRONMENT_TOLERANCE_POINTS);
    }
    console.table(rows);
    if (raise) {
      writeFileSync(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
      console.warn('[feature-coverage] floors raised to current coverage');
    }
  }

  if (problems.length > 0) {
    for (const p of problems) console.error(`[feature-coverage] ${p}`);
    process.exit(1);
  }
  console.warn(`[feature-coverage] ok: ${owner.size} source files mapped to ${registry.features.length} features`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
