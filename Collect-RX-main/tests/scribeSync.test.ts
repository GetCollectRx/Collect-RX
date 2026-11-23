import { describe, it, expect } from 'vitest';
import { diffScribeScenarios, scenariosFromToolSchema } from '../src/outcome/scribeSync';
import { KNOWN_SCRIBE_SCENARIOS } from '../src/outcome/humanAssistedOutcomeResolver';

describe('scribe sync', () => {
  it('reports no drift when the prompt names every scenario', () => {
    const r = diffScribeScenarios(KNOWN_SCRIBE_SCENARIOS.join(' '), [...KNOWN_SCRIBE_SCENARIOS]);
    expect(r).toEqual({ missingInPrompt: [], unknownInPrompt: [] });
  });
  it('reports a scenario removed from the prompt and an unknown tool value', () => {
    const r = diffScribeScenarios('CLAIM_PAID only', ['CLAIM_PAID', 'NEW_THING']);
    expect(r.missingInPrompt).toContain('UNCLEAR');
    expect(r.unknownInPrompt).toEqual(['NEW_THING']);
  });
  it('reads the enum from a tool schema', () => {
    expect(scenariosFromToolSchema({ function: { parameters: { properties: { scenario: { enum: ['A'] } } } } })).toEqual(['A']);
    expect(scenariosFromToolSchema({})).toEqual([]);
  });
});
