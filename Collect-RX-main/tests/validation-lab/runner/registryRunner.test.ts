/**
 * Registry runner: runs the validation-lab scenarios that can run offline today and
 * reports every one of the 248 as PASS, FAIL, FINDING or UNVERIFIED.
 *
 * Like the Stage 1 harness, the vitest result proves harness integrity only (the
 * bindings point at real registry ids, nothing left the process, teardown was clean,
 * no transcript text reached an artifact). The product verdict is in REPORT.md and
 * run-log.jsonl under SIM_RUN_DIR. A FAIL or FINDING there is a product result and
 * never fails the vitest run.
 *
 * Scenarios without a binding are reported UNVERIFIED with the reason and the class
 * of work that would run them. A scenario is never counted at a higher evidence level
 * than the one it ran at.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../src/server/index.js';
import { acquireSimLock, releaseSimLock } from '../../sim-harness/simLock.js';
import { OutboundInterceptor } from '../../sim-harness/outboundInterceptor.js';
import { RunLog, type CheckStatus } from '../../sim-harness/runLog.js';
import { buildDispatchBindings, setupDispatchWorld, teardownDispatchWorld, type DispatchWorld } from './dispatchBindings.js';
import { buildPostCallBindings, SYNTHETIC_TRANSCRIPT_PHRASES } from './postCallBindings.js';
import { buildStatefulBindings } from './statefulBindings.js';
import { StatefulWorld } from './statefulWorld.js';
import type { Binding, Level } from './types.js';

try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
} catch (e) {
  throw new Error(`registryRunner requires a live DATABASE_URL: ${(e as Error).message}`);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY = path.resolve(here, '../../../validation-lab/registry/scenarios.json');

interface RegistryScenario {
  id: string;
  tier: string;
  name: string;
  description: string;
  layer: string;
  harness: string;
  implementation: string;
  preconditions: { syntheticOnly: boolean };
}

type Executability = 'RAN_OFFLINE' | 'RUNS_OFFLINE_NOT_YET_BOUND' | 'NEEDS_HARNESS' | 'NEEDS_LIVE_CALL';

interface Row {
  id: string;
  layer: string;
  tier: string;
  harness: string;
  name: string;
  status: CheckStatus;
  level: Level | '-';
  executability: Executability;
  observed: string;
  note: string;
}

const registry = (JSON.parse(readFileSync(REGISTRY, 'utf8')) as { scenarios: RegistryScenario[] }).scenarios;

function unboundReason(s: RegistryScenario): { executability: Executability; note: string } {
  switch (s.harness) {
    case 'telephony_controlled':
      return { executability: 'NEEDS_LIVE_CALL', note: 'The Carrier Twin models this offline (stage2), but product behaviour on this scenario needs a live dial of the squad. Blocked by the pre-call gate.' };
    case 'supervised_pilot':
      return { executability: 'NEEDS_LIVE_CALL', note: 'Supervised pilot or browser check. Needs a live environment or a person.' };
    case 'carrier_conversation':
      return { executability: 'NEEDS_HARNESS', note: 'Needs the text conversation harness (agent prompts against a simulated rep). Not on main and not in an open pull request at the time of this run.' };
    case 'transcript_outcome':
      return { executability: 'RUNS_OFFLINE_NOT_YET_BOUND', note: 'Can run offline through the real outcome code, or the webhook route for the stateful ones. Not bound in batch 1.' };
    case 'scenario_vitest':
      return { executability: 'RUNS_OFFLINE_NOT_YET_BOUND', note: 'Can run offline. Needs the queue tick or a route, which is Stage 1 style work, not bound in batch 1.' };
    default:
      return { executability: 'NEEDS_HARNESS', note: 'Unknown harness value.' };
  }
}

describe('validation-lab registry runner', () => {
  let world: DispatchWorld | null = null;
  let stateful: StatefulWorld | null = null;
  let statefulConnected = false;
  let statefulIds = new Set<string>();
  const interceptor = new OutboundInterceptor();
  const rows: Row[] = [];
  let log: RunLog;
  let bindings: Record<string, Binding> = {};

  beforeAll(async () => {
    await acquireSimLock();
    interceptor.install();
    log = new RunLog(`registry-${new Date().toISOString().replace(/[:.]/gu, '-')}`);
    world = await setupDispatchWorld(prisma);
    stateful = new StatefulWorld(interceptor);
    const statefulBindings = buildStatefulBindings(stateful);
    statefulIds = new Set(Object.keys(statefulBindings));
    bindings = { ...buildDispatchBindings(world), ...buildPostCallBindings(), ...statefulBindings };
  }, 120_000);

  afterAll(async () => {
    interceptor.uninstall();
    let residual = 0;
    if (world) residual = await teardownDispatchWorld(world);
    if (stateful && statefulConnected) residual += await stateful.teardown();
    await prisma.$disconnect().catch(() => undefined);
    releaseSimLock();
    if (residual !== 0) throw new Error(`registryRunner teardown left ${residual} synthetic practice rows behind`);
  }, 60_000);

  it('runs every bound scenario and reports every registry scenario', async () => {
    const order = new Map(registry.map((s, i) => [s.id, i]));
    const runOne = async (s: RegistryScenario): Promise<void> => {
      const binding = bindings[s.id];
      if (!binding) {
        const r = unboundReason(s);
        rows.push({ id: s.id, layer: s.layer, tier: s.tier, harness: s.harness, name: s.name, status: 'UNVERIFIED', level: '-', executability: r.executability, observed: 'not run', note: r.note });
        return;
      }
      try {
        const res = await binding();
        rows.push({ id: s.id, layer: s.layer, tier: s.tier, harness: s.harness, name: s.name, status: res.status, level: res.level, executability: 'RAN_OFFLINE', observed: res.observed, note: res.proves });
      } catch (err) {
        const kind = err instanceof Error ? err.constructor.name : 'unknown';
        rows.push({ id: s.id, layer: s.layer, tier: s.tier, harness: s.harness, name: s.name, status: 'FAIL', level: 'U', executability: 'RAN_OFFLINE', observed: `binding threw ${kind}`, note: 'The binding itself errored, so the scenario did not complete. Treat as a harness or product fault until diagnosed.' });
      }
    };
    // Stateless bindings first: the stateful world forces the call window open for the tick.
    for (const s of registry.filter((x) => !statefulIds.has(x.id))) await runOne(s);
    if (stateful) {
      await stateful.connect();
      statefulConnected = true;
      for (const s of registry.filter((x) => statefulIds.has(x.id))) await runOne(s);
    }
    rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    for (const r of rows) log.record(r.layer, r.level, `${r.id} ${r.name}`, r.status, `${r.observed}. ${r.note}`);

    const counts = (st: CheckStatus): number => rows.filter((r) => r.status === st).length;
    const cell = (s: string): string => s.replace(/\|/gu, '/').replace(/\n/gu, ' ');
    const byLayer = (layer: string): string => {
      const l = rows.filter((r) => r.layer === layer);
      const n = (st: CheckStatus): number => l.filter((r) => r.status === st).length;
      return `| ${layer} | ${l.length} | ${n('PASS')} | ${n('FAIL')} | ${n('FINDING')} | ${n('UNVERIFIED')} |`;
    };
    const report = [
      `# Registry runner ${log.runId}`,
      '',
      `Scenarios reported: ${rows.length} of ${registry.length}. PASS ${counts('PASS')}, FAIL ${counts('FAIL')}, FINDING ${counts('FINDING')}, UNVERIFIED ${counts('UNVERIFIED')}.`,
      '',
      'Evidence level is shown per row. U is a real production function with synthetic data. S is the real pipeline or route with a stubbed Vapi. Nothing here is a mock Vapi server run, a browser walk, an owned-number run or a real carrier call, and no request left the process.',
      '',
      '## By layer',
      '',
      '| Layer | Scenarios | PASS | FAIL | FINDING | UNVERIFIED |',
      '|---|---|---|---|---|---|',
      ...['dispatch', 'post_call', 'handoff', 'ivr', 'conversation', 'ops'].map(byLayer),
      '',
      '## Run results (bound scenarios)',
      '',
      '| ID | Layer | Tier | Level | Status | Observed (codes only) | What it proves and leaves unproven |',
      '|---|---|---|---|---|---|---|',
      ...rows.filter((r) => r.executability === 'RAN_OFFLINE').map((r) => `| ${r.id} | ${r.layer} | ${r.tier} | ${r.level} | ${r.status} | ${cell(r.observed)} | ${cell(r.note)} |`),
      '',
      '## Not run',
      '',
      '| ID | Layer | Tier | Harness | Class | Reason |',
      '|---|---|---|---|---|---|',
      ...rows.filter((r) => r.executability !== 'RAN_OFFLINE').map((r) => `| ${r.id} | ${r.layer} | ${r.tier} | ${r.harness} | ${r.executability} | ${cell(r.note)} |`),
      '',
    ].join('\n');
    writeFileSync(path.join(log.dir, 'REPORT.md'), report);
    writeFileSync(path.join(log.dir, 'rows.json'), JSON.stringify(rows, null, 1));
    console.warn(`[registry-runner] PASS ${counts('PASS')} FAIL ${counts('FAIL')} FINDING ${counts('FINDING')} UNVERIFIED ${counts('UNVERIFIED')} report ${path.join(log.dir, 'REPORT.md')}`);

    expect(rows.length).toBe(registry.length);
  }, 180_000);

  it('integrity: bindings point at real registry ids, honest levels, synthetic only', () => {
    const ids = new Set(registry.map((s) => s.id));
    const unknown = Object.keys(bindings).filter((id) => !ids.has(id));
    expect(unknown).toEqual([]);
    expect(registry.every((s) => s.preconditions.syntheticOnly === true)).toBe(true);
    expect(rows.filter((r) => r.executability === 'RAN_OFFLINE').every((r) => r.level === 'U' || r.level === 'S')).toBe(true);
    expect(rows.filter((r) => r.executability !== 'RAN_OFFLINE').every((r) => r.status === 'UNVERIFIED')).toBe(true);
  });

  it('integrity: no transcript text at rest, nothing left the process', () => {
    const artifacts = [path.join(log.dir, 'REPORT.md'), path.join(log.dir, 'run-log.jsonl'), path.join(log.dir, 'rows.json')].map((p) => readFileSync(p, 'utf8')).join('\n');
    const leaked = SYNTHETIC_TRANSCRIPT_PHRASES.filter((phrase) => artifacts.includes(phrase));
    expect(leaked).toEqual([]);
    expect(interceptor.blocked().length).toBe(0);
    expect(interceptor.blockedNodeRequests).toEqual([]);
  });
});
