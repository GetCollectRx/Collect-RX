/**
 * Traceability from the validation-lab registry to the Carrier Twin.
 *
 * validation-lab/registry/scenarios.json marks 45 scenarios as
 * `telephony_controlled`: the ones that need a controlled phone system. This
 * test fails if one of them has no twin implementation and is not listed with
 * a reason in UNMODELED_REGISTRY_IDS, so the twin cannot quietly fall behind
 * the catalog.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { baselineScenario, twinScenarioForRegistryId, UNMODELED_REGISTRY_IDS } from './scenarios.js';
import { failures, scoreCall } from './scoring.js';
import type { TwinEvent } from './carrierTwin.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CARRIERS_DIR = path.resolve(here, '../../../carriers');
const REGISTRY = path.resolve(here, '../../../validation-lab/registry/scenarios.json');

interface RegistryScenario {
  id: string;
  harness: string;
  tier: string;
}

const telephony = (JSON.parse(readFileSync(REGISTRY, 'utf8')) as { scenarios: RegistryScenario[] }).scenarios.filter((s) => s.harness === 'telephony_controlled');

describe('registry coverage', () => {
  it('every telephony_controlled registry scenario is implemented by the twin or explicitly listed as unmodeled', () => {
    const missing: string[] = [];
    let modeled = 0;
    for (const s of telephony) {
      if (UNMODELED_REGISTRY_IDS[s.id]) continue;
      const sc = twinScenarioForRegistryId(s.id, CARRIERS_DIR);
      if (sc && sc.registryId === s.id) modeled += 1;
      else missing.push(s.id);
    }
    expect(missing).toEqual([]);
    expect(modeled + Object.keys(UNMODELED_REGISTRY_IDS).length).toBe(telephony.length);
    console.warn(`[stage2-coverage] ${modeled} of ${telephony.length} telephony_controlled registry scenarios modeled; unmodeled: ${Object.keys(UNMODELED_REGISTRY_IDS).join(', ')}`);
  });

  it('the registry still has the 45 scenarios this twin was built against', () => {
    expect(telephony.length).toBe(45);
  });
});

describe('scoring of the registry-driven hazards', () => {
  const ev = (kind: TwinEvent['kind'], at: number, detail = ''): TwinEvent => ({ at, callSid: 'CA-x', scenarioId: 's', kind, detail });
  const obs = { mode: 'human_assisted' as const, dialedAt: 0, endedAt: 60_000, transferRequestedAt: null, claimMarkedResolved: false, assistantUtterances: [] };

  it('flags an agent that speaks after a voicemail greeting (leaves a message)', () => {
    const sc = twinScenarioForRegistryId('IVR-VM-sun_life', CARRIERS_DIR);
    if (!sc) throw new Error('IVR-VM-sun_life missing');
    const clean = failures(scoreCall(sc, [ev('hold_start', 1000), ev('rep_answer', 2000), ev('voicemail_greeting', 3000)], obs));
    const left = failures(scoreCall(sc, [ev('hold_start', 1000), ev('rep_answer', 2000), ev('voicemail_greeting', 3000), ev('agent_speech', 4000, 'please call me back about claim')], obs));
    expect(clean.map((f) => f.name)).not.toContain('Did not leave a voicemail message');
    expect(left.map((f) => f.name)).toContain('Did not leave a voicemail message');
  });

  it('flags an agent that transfers staff after a callback offer', () => {
    const sc = twinScenarioForRegistryId('IVR-CB-manulife', CARRIERS_DIR);
    if (!sc) throw new Error('IVR-CB-manulife missing');
    const events = [ev('hold_start', 1000), ev('callback_offered', 2000)];
    expect(failures(scoreCall(sc, events, obs)).map((f) => f.name)).not.toContain('Callback offer handled without a staff transfer');
    expect(failures(scoreCall(sc, events, { ...obs, transferRequestedAt: 5000 })).map((f) => f.name)).toContain('Callback offer handled without a staff transfer');
  });

  it('keeps a plain baseline importable for every carrier the registry names', () => {
    for (const c of ['sun_life', 'canada_life', 'manulife', 'green_shield', 'rbc', 'telus_adjudicare']) {
      expect(baselineScenario(CARRIERS_DIR, c).steps.length).toBeGreaterThan(2);
    }
  });
});
