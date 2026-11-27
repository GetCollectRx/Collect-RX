import { afterAll, describe, expect, it } from 'vitest';
import { FLAWS, judge, runScenario, type FlawId } from './squadDriver.js';
import { SCENARIOS } from './mockRep.js';

/**
 * Offline evaluation of the squad and handoff logic against mock reps.
 * No telephony, no network, no paid service, no database.
 *
 * KNOWN_FINDINGS lists scenarios where the product currently departs from the
 * written rule. They are asserted as findings, not hidden: the suite fails if
 * a listed finding stops reproducing (remove the entry) or a new one appears.
 */
const KNOWN_FINDINGS: Readonly<Record<string, string>> = {
  S12: 'checkCarrierBlock also pauses sibling locations in the same organization. Owner rule: blocks are practice level only.',
};

const report: string[] = [];
afterAll(() => {
  console.info(['', 'AUTONOMOUS EVAL REPORT', ...report, ''].join('\n'));
});

describe('mock rep scenarios against the reference wiring', () => {
  for (const scenario of SCENARIOS) {
    const finding = KNOWN_FINDINGS[scenario.id];
    it(`${scenario.id} ${scenario.title}${finding ? ' (known finding)' : ''}`, async () => {
      const result = await runScenario(scenario);
      const fails = judge(scenario, result);
      report.push(`${scenario.id} ${fails.length === 0 ? 'PASS' : finding ? 'FINDING' : 'FAIL'}${fails.length ? ': ' + fails.join('; ') : ''}`);
      if (finding) {
        expect(fails.length, `${scenario.id} no longer reproduces; remove it from KNOWN_FINDINGS`).toBeGreaterThan(0);
      } else {
        expect(fails).toEqual([]);
      }
    });
  }
});

describe('seeded flaws are caught', () => {
  for (const flaw of FLAWS) {
    it(`${flaw.id} ${flaw.title}`, async () => {
      const caughtBy: string[] = [];
      for (const scenario of SCENARIOS) {
        const clean = judge(scenario, await runScenario(scenario)).length === 0;
        const flawed = judge(scenario, await runScenario(scenario, flaw.id as FlawId)).length > 0;
        if (clean && flawed) caughtBy.push(scenario.id);
      }
      report.push(`${flaw.id} caught by ${caughtBy.length ? caughtBy.join(', ') : 'NOTHING'}`);
      expect(caughtBy.length, `no scenario that passes cleanly detects ${flaw.id}`).toBeGreaterThan(0);
    });
  }
});
