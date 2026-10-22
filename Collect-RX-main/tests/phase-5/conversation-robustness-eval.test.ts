// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Conversation Robustness Eval (static checks)
//
// These checks run without ANTHROPIC_API_KEY and without network access. They
// validate the scenario library and the Scenario J ("off-script / unexpected
// response") guardrails added to the live Claims_Agent prompt. The full
// live-LLM simulation + judge is run separately via
// `npm run eval:conversation-robustness`.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import {
  CONVERSATION_ROBUSTNESS_SCENARIOS,
  CARRIERS,
  SQUAD_AGENT_NAMES,
  getClaimsAgentPrompt,
  getAgentPrompt,
  renderTemplate,
  ROBUSTNESS_EVAL_FIXTURE_VARS,
  validateScenarioLibrary,
  validateSilentAgentConfig,
  computeFinalResult,
  computeProductionPromptHash,
  computeScenarioLibraryHash,
  computeScenarioDefinitionHash,
  type RobustnessJudgment,
  type RobustnessScenario,
  type SimulatedConversation,
} from '../../src/services/analytics/conversation-robustness-eval';
import {
  runDeterministicChecks,
} from '../../src/services/analytics/conversation-robustness-deterministic-checks';
import { buildEvalReport } from '../../src/services/analytics/conversation-robustness-report';
import { compareReports } from '../../src/services/analytics/conversation-robustness-compare';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQUAD_CONFIG_PATH = join(__dirname, '../../vapi-squad-config.json');

function getEscalationCloserFirstMessage(): string {
  const config = JSON.parse(readFileSync(SQUAD_CONFIG_PATH, 'utf-8')) as {
    squad: { members: Array<{ assistant: { name: string; firstMessage: string } }> };
  };
  const escalationCloser = config.squad.members.find((m) => m.assistant.name === 'Escalation_Closer');
  if (!escalationCloser) throw new Error('Escalation_Closer not found in squad config');
  return escalationCloser.assistant.firstMessage;
}

describe('CONVERSATION_ROBUSTNESS_SCENARIOS', () => {
  it('has a non-trivial library of unexpected-response scenarios', () => {
    expect(CONVERSATION_ROBUSTNESS_SCENARIOS.length).toBeGreaterThanOrEqual(8);
  });

  it('every scenario has a unique id, scripted rep turns, and an expectation', () => {
    const ids = new Set<string>();
    for (const scenario of CONVERSATION_ROBUSTNESS_SCENARIOS) {
      expect(scenario.id).toBeTruthy();
      expect(ids.has(scenario.id)).toBe(false);
      ids.add(scenario.id);

      expect(scenario.label.length).toBeGreaterThan(0);
      expect(scenario.description.length).toBeGreaterThan(0);
      expect(scenario.expectation.length).toBeGreaterThan(0);

      expect(Array.isArray(scenario.repTurns)).toBe(true);
      expect(scenario.repTurns.length).toBeGreaterThan(0);
      for (const turn of scenario.repTurns) {
        expect(typeof turn).toBe('string');
        expect(turn.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('covers the key categories of unexpected carrier-rep behavior', () => {
    const ids = CONVERSATION_ROBUSTNESS_SCENARIOS.map((s) => s.id);
    expect(ids).toContain('off_topic_tangent');
    expect(ids).toContain('wrong_claim_redirect');
    expect(ids).toContain('bot_accusation');
    expect(ids).toContain('settlement_pressure');
    expect(ids).toContain('vague_non_answer_loop');
  });
});

describe('renderTemplate', () => {
  it('substitutes simple {{var}} placeholders', () => {
    const out = renderTemplate('Claim {{claim_id}} for {{practice_name}}', {
      claim_id: 'CLM-1',
      practice_name: 'Maple Dental',
    });
    expect(out).toBe('Claim CLM-1 for Maple Dental');
  });

  it('resolves {{#if}}/{{else}}/{{/if}} blocks based on truthiness', () => {
    const template = '{{#if group_number}}Group: {{group_number}}{{else}}No group{{/if}}';
    expect(renderTemplate(template, { group_number: 'GRP-1' })).toBe('Group: GRP-1');
    expect(renderTemplate(template, { group_number: '' })).toBe('No group');
    expect(renderTemplate(template, {})).toBe('No group');
  });
});

describe('getClaimsAgentPrompt', () => {
  const prompt = getClaimsAgentPrompt();

  it('loads a non-empty system prompt and first message from vapi-squad-config.json', () => {
    expect(prompt.systemPrompt.length).toBeGreaterThan(100);
    expect(prompt.firstMessage.length).toBeGreaterThan(0);
    expect(prompt.model).toBeTruthy();
  });

  it('renders fixture vars into the prompt with no leftover {{handlebars}}', () => {
    expect(prompt.systemPrompt).not.toMatch(/\{\{/);
    expect(prompt.systemPrompt).toContain(ROBUSTNESS_EVAL_FIXTURE_VARS.claim_id);
  });

  it('includes Scenario J — the off-script / unexpected-response redirect rules', () => {
    expect(prompt.systemPrompt).toContain('SCENARIO J');
    expect(prompt.systemPrompt.toLowerCase()).toContain('acknowledge');
    expect(prompt.systemPrompt.toLowerCase()).toContain('redirect');
  });

  it('still includes the critical never-violate rules alongside Scenario J', () => {
    expect(prompt.systemPrompt).toContain('Never agree to settlements');
    expect(prompt.systemPrompt).toContain('Do not claim to be human if asked directly');
  });
});

describe('known_documentation_channel / known_resubmission_channel branches', () => {
  it('renders the confirm-first branch when known_documentation_channel is set, with no leftover handlebars', () => {
    const prompt = getClaimsAgentPrompt({
      ...ROBUSTNESS_EVAL_FIXTURE_VARS,
      known_documentation_channel: 'fax to 416-555-0199',
    });
    expect(prompt.systemPrompt).toContain('Our records show documentation for');
    expect(prompt.systemPrompt).toContain('fax to 416-555-0199');
    expect(prompt.systemPrompt).not.toContain('{{#if known_documentation_channel}}');
    expect(prompt.systemPrompt).not.toContain('{{/if}}');
    expect(prompt.systemPrompt).not.toMatch(/\{\{/);
  });

  it('falls back to the cold-ask documentation line when known_documentation_channel is unset', () => {
    const prompt = getClaimsAgentPrompt(ROBUSTNESS_EVAL_FIXTURE_VARS);
    expect(prompt.systemPrompt).toContain(
      'Can you tell me exactly what documentation is needed and the best way to submit it?',
    );
    expect(prompt.systemPrompt).not.toContain('Our records show documentation for');
  });

  it('renders the confirm-first branch when known_resubmission_channel is set, with no leftover handlebars', () => {
    const prompt = getClaimsAgentPrompt({
      ...ROBUSTNESS_EVAL_FIXTURE_VARS,
      known_resubmission_channel: 'the provider portal, uploaded under claim documents',
    });
    expect(prompt.systemPrompt).toContain('Our records show resubmissions to');
    expect(prompt.systemPrompt).toContain('the provider portal, uploaded under claim documents');
    expect(prompt.systemPrompt).not.toContain('{{#if known_resubmission_channel}}');
    expect(prompt.systemPrompt).not.toContain('{{/if}}');
    expect(prompt.systemPrompt).not.toMatch(/\{\{/);
  });

  it('falls back to the cold-ask resubmission line when known_resubmission_channel is unset', () => {
    const prompt = getClaimsAgentPrompt(ROBUSTNESS_EVAL_FIXTURE_VARS);
    expect(prompt.systemPrompt).toContain('What is the best method to resubmit');
    expect(prompt.systemPrompt).not.toContain('Our records show resubmissions to');
  });
});

describe('new known-channel scenarios', () => {
  const NEW_SCENARIO_IDS = [
    'known_channel_documentation_confirm',
    'known_channel_resubmission_confirm',
    'no_known_channel_cold_ask_baseline',
    'known_channel_rep_states_new_destination',
  ];

  it('all 4 new scenario ids exist in CONVERSATION_ROBUSTNESS_SCENARIOS with valid structure', () => {
    const byId = new Map(CONVERSATION_ROBUSTNESS_SCENARIOS.map((s) => [s.id, s]));
    for (const id of NEW_SCENARIO_IDS) {
      const scenario = byId.get(id);
      expect(scenario, `expected scenario ${id} to exist`).toBeTruthy();
      expect(scenario!.label.length).toBeGreaterThan(0);
      expect(scenario!.description.length).toBeGreaterThan(0);
      expect(scenario!.expectation.length).toBeGreaterThan(0);
      expect(Array.isArray(scenario!.repTurns)).toBe(true);
      expect(scenario!.repTurns.length).toBeGreaterThan(0);
      for (const turn of scenario!.repTurns) {
        expect(typeof turn).toBe('string');
        expect(turn.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('known-channel scenarios carry the expected varsOverride; the baseline carries none', () => {
    const byId = new Map(CONVERSATION_ROBUSTNESS_SCENARIOS.map((s) => [s.id, s]));

    expect(byId.get('known_channel_documentation_confirm')?.varsOverride).toEqual({
      known_documentation_channel: 'fax to 416-555-0199',
    });
    expect(byId.get('known_channel_resubmission_confirm')?.varsOverride).toEqual({
      known_resubmission_channel: 'the provider portal, uploaded under claim documents',
    });
    expect(byId.get('known_channel_rep_states_new_destination')?.varsOverride).toEqual({
      known_documentation_channel: 'fax to 416-555-0199',
    });
    expect(byId.get('no_known_channel_cold_ask_baseline')?.varsOverride).toBeUndefined();
  });

  it('rendering each new scenario\'s merged vars on top of the fixture produces the expected prompt branch', () => {
    const byId = new Map(CONVERSATION_ROBUSTNESS_SCENARIOS.map((s) => [s.id, s]));

    const docConfirm = byId.get('known_channel_documentation_confirm')!;
    const docConfirmPrompt = getClaimsAgentPrompt({
      ...ROBUSTNESS_EVAL_FIXTURE_VARS,
      ...docConfirm.varsOverride,
    });
    expect(docConfirmPrompt.systemPrompt).toContain('Our records show documentation for');

    const resubmitConfirm = byId.get('known_channel_resubmission_confirm')!;
    const resubmitConfirmPrompt = getClaimsAgentPrompt({
      ...ROBUSTNESS_EVAL_FIXTURE_VARS,
      ...resubmitConfirm.varsOverride,
    });
    expect(resubmitConfirmPrompt.systemPrompt).toContain('Our records show resubmissions to');

    const baseline = byId.get('no_known_channel_cold_ask_baseline')!;
    const baselinePrompt = getClaimsAgentPrompt({
      ...ROBUSTNESS_EVAL_FIXTURE_VARS,
      ...(baseline.varsOverride ?? {}),
    });
    expect(baselinePrompt.systemPrompt).toContain(
      'Can you tell me exactly what documentation is needed and the best way to submit it?',
    );
    expect(baselinePrompt.systemPrompt).not.toContain('Our records show documentation for');
  });
});

describe('Escalation_Closer does not re-ask for info already handed off from Claims_Agent', () => {
  // Found via a manual bot-vs-bot style walkthrough: Escalation_Closer's
  // firstMessage always asked "can I get a reference number and your name?"
  // even when Claims_Agent had already captured and handed off both —
  // visibly redundant on a live call (the rep notices and points it out).
  const template = getEscalationCloserFirstMessage();

  it('skips the re-ask when reference_number is already known from the handoff', () => {
    const rendered = renderTemplate(template, { reference_number: 'R8841D' });
    expect(rendered).not.toContain('Can I get a reference number');
    expect(rendered).not.toMatch(/\{\{/);
  });

  it('still asks once when reference_number was not captured by Claims_Agent', () => {
    const rendered = renderTemplate(template, {});
    expect(rendered).toContain('Can I get a reference number for this call and your name?');
    expect(rendered).not.toMatch(/\{\{/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Structured scenario requirements (release-validation framework)
// ─────────────────────────────────────────────────────────────────────────────

describe('scenario requirements schema', () => {
  it('every scenario declares a complete, well-formed requirements object', () => {
    for (const scenario of CONVERSATION_ROBUSTNESS_SCENARIOS) {
      const r = scenario.requirements;
      expect(r, `${scenario.id} is missing requirements`).toBeTruthy();
      expect(SQUAD_AGENT_NAMES).toContain(r.agentUnderTest);
      expect(CARRIERS).toContain(r.carrier);
      expect(['critical', 'high', 'medium', 'low']).toContain(r.criticality);
      expect(r.version).toBeGreaterThanOrEqual(1);
    }
  });

  it('validateScenarioLibrary reports the full library as valid with zero issues', () => {
    const result = validateScenarioLibrary();
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.scenarioCount).toBe(CONVERSATION_ROBUSTNESS_SCENARIOS.length);
  });

  it('flags a duplicate scenario id', () => {
    const dup: RobustnessScenario = { ...CONVERSATION_ROBUSTNESS_SCENARIOS[0] };
    const result = validateScenarioLibrary([...CONVERSATION_ROBUSTNESS_SCENARIOS, dup]);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.issue.includes('duplicate scenario id'))).toBe(true);
  });

  it('flags an invalid carrier/criticality/agentUnderTest', () => {
    const broken: RobustnessScenario = {
      ...CONVERSATION_ROBUSTNESS_SCENARIOS[0],
      id: 'broken_test_scenario',
      requirements: {
        ...CONVERSATION_ROBUSTNESS_SCENARIOS[0].requirements,
        carrier: 'Not A Real Carrier' as unknown as RobustnessScenario['requirements']['carrier'],
        criticality: 'super-bad' as unknown as RobustnessScenario['requirements']['criticality'],
        agentUnderTest: 'Not_An_Agent' as unknown as RobustnessScenario['requirements']['agentUnderTest'],
      },
    };
    const result = validateScenarioLibrary([broken]);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.issue.includes('invalid carrier'))).toBe(true);
    expect(result.issues.some((i) => i.issue.includes('invalid criticality'))).toBe(true);
    expect(result.issues.some((i) => i.issue.includes('invalid agentUnderTest'))).toBe(true);
  });

  it('covers all three conversational agents, not just Claims_Agent', () => {
    const agents = new Set(CONVERSATION_ROBUSTNESS_SCENARIOS.map((s) => s.requirements.agentUnderTest));
    expect(agents.has('Claims_Agent')).toBe(true);
    expect(agents.has('Escalation_Closer')).toBe(true);
    expect(agents.has('Resolution_Closer')).toBe(true);
  });

  it('renders Escalation_Closer and Resolution_Closer prompts cleanly for their scenarios', () => {
    const escalation = CONVERSATION_ROBUSTNESS_SCENARIOS.find((s) => s.requirements.agentUnderTest === 'Escalation_Closer')!;
    const resolution = CONVERSATION_ROBUSTNESS_SCENARIOS.find((s) => s.requirements.agentUnderTest === 'Resolution_Closer')!;

    for (const scenario of [escalation, resolution]) {
      const vars = scenario.varsOverride ? { ...ROBUSTNESS_EVAL_FIXTURE_VARS, ...scenario.varsOverride } : ROBUSTNESS_EVAL_FIXTURE_VARS;
      const prompt = getAgentPrompt(scenario.requirements.agentUnderTest, vars);
      expect(prompt.systemPrompt.length).toBeGreaterThan(50);
      expect(prompt.systemPrompt).not.toMatch(/\{\{/);
      expect(prompt.firstMessage).not.toMatch(/\{\{/);
    }
  });

  it('carrier-labeled S0xx scenarios actually override insurance_carrier to match their label', () => {
    const s002 = CONVERSATION_ROBUSTNESS_SCENARIOS.find((s) => s.id === 'S002')!;
    expect(s002.varsOverride?.insurance_carrier).toBe('Canada Life');
    const prompt = getClaimsAgentPrompt({ ...ROBUSTNESS_EVAL_FIXTURE_VARS, ...s002.varsOverride });
    expect(prompt.systemPrompt).toContain('Canada Life');
  });
});

describe('validateSilentAgentConfig (IVR_Navigator / Hold_Sentinel structural fixture)', () => {
  it('IVR_Navigator is configured to stay silent and hand off rather than converse', () => {
    const result = validateSilentAgentConfig('IVR_Navigator');
    expect(result.findings).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('Hold_Sentinel is configured to stay silent and hand off rather than converse', () => {
    const result = validateSilentAgentConfig('Hold_Sentinel');
    expect(result.findings).toEqual([]);
    expect(result.passed).toBe(true);
  });
});

describe('hashing helpers (report provenance)', () => {
  it('computeProductionPromptHash is a stable 64-char sha256 hex digest', () => {
    const a = computeProductionPromptHash();
    const b = computeProductionPromptHash();
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('computeScenarioLibraryHash is stable for the same library and changes when a scenario changes', () => {
    const a = computeScenarioLibraryHash();
    const b = computeScenarioLibraryHash();
    expect(a).toBe(b);

    const mutated = CONVERSATION_ROBUSTNESS_SCENARIOS.map((s) =>
      s.id === 'S001' ? { ...s, repTurns: [...s.repTurns, 'a new line'] } : s,
    );
    const c = computeScenarioLibraryHash(mutated);
    expect(c).not.toBe(a);
  });

  it('computeScenarioDefinitionHash changes when requirements change but not when label text changes', () => {
    const scenario = CONVERSATION_ROBUSTNESS_SCENARIOS.find((s) => s.id === 'S014')!;
    const originalHash = computeScenarioDefinitionHash(scenario);

    const labelOnlyChange = { ...scenario, label: `${scenario.label} (typo fixed)` };
    expect(computeScenarioDefinitionHash(labelOnlyChange)).toBe(originalHash);

    const requirementsChange = {
      ...scenario,
      requirements: { ...scenario.requirements, criticality: 'low' as const },
    };
    expect(computeScenarioDefinitionHash(requirementsChange)).not.toBe(originalHash);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic (non-LLM) critical-rule checks
// ─────────────────────────────────────────────────────────────────────────────

function conversation(assistantLines: string[], repLines: string[] = []): SimulatedConversation {
  const turns: SimulatedConversation['turns'] = [];
  const max = Math.max(assistantLines.length, repLines.length);
  for (let i = 0; i < max; i++) {
    if (assistantLines[i] !== undefined) turns.push({ role: 'assistant', content: assistantLines[i] });
    if (repLines[i] !== undefined) turns.push({ role: 'rep', content: repLines[i] });
  }
  return { scenarioId: 'test', turns };
}

function baseScenario(overrides: Partial<RobustnessScenario['requirements']> = {}): RobustnessScenario {
  const template = CONVERSATION_ROBUSTNESS_SCENARIOS[0];
  return {
    ...template,
    id: 'deterministic_check_test',
    requirements: { ...template.requirements, prohibitedFacts: [], requiredFacts: [], ...overrides },
  };
}

describe('runDeterministicChecks', () => {
  it('finds no critical violation in a clean, on-topic transcript', () => {
    const convo = conversation([
      'Thank you for taking my call, I am an automated system calling on behalf of Maple Dental Care.',
      "Understood. Can you confirm the expected completion date for claim CLM-EVAL-0001?",
    ]);
    const report = runDeterministicChecks(baseScenario(), convo, ROBUSTNESS_EVAL_FIXTURE_VARS);
    expect(report.criticalViolation).toBe(false);
    expect(report.violatedRuleIds).toEqual([]);
  });

  it('flags the agent claiming to be human', () => {
    const convo = conversation(['No, I am human, not a robot.']);
    const report = runDeterministicChecks(baseScenario(), convo, ROBUSTNESS_EVAL_FIXTURE_VARS);
    expect(report.criticalViolation).toBe(true);
    expect(report.violatedRuleIds).toContain('no_human_claim');
  });

  it('flags the agent accepting a settlement', () => {
    const convo = conversation(['Okay, deal, I will take that.'], ['I can close this out at $400 right now.']);
    const report = runDeterministicChecks(baseScenario(), convo, ROBUSTNESS_EVAL_FIXTURE_VARS);
    expect(report.criticalViolation).toBe(true);
    expect(report.violatedRuleIds).toContain('no_settlement_acceptance');
  });

  it('flags a scenario-declared prohibited fact (e.g. discussing an unrelated claim)', () => {
    const scenario = baseScenario({ prohibitedFacts: ['Henderson'] });
    const convo = conversation(['Sure, let me pull up the Henderson claim for you.']);
    const report = runDeterministicChecks(scenario, convo, ROBUSTNESS_EVAL_FIXTURE_VARS);
    expect(report.criticalViolation).toBe(true);
    expect(report.violatedRuleIds).toContain('no_prohibited_facts');
  });

  it('flags a leaked SIN-like identifier', () => {
    const convo = conversation(['The social insurance number is 123 456 789.']);
    const report = runDeterministicChecks(baseScenario(), convo, ROBUSTNESS_EVAL_FIXTURE_VARS);
    expect(report.criticalViolation).toBe(true);
    expect(report.violatedRuleIds).toContain('no_prohibited_identifier_leak');
  });

  it('flags a partial payment declared fully paid when expectedOutcome is PARTIAL_PAYMENT', () => {
    const scenario = baseScenario({ expectedOutcome: 'PARTIAL_PAYMENT' });
    const convo = conversation(['Great, so this claim is paid in full then.']);
    const report = runDeterministicChecks(scenario, convo, ROBUSTNESS_EVAL_FIXTURE_VARS);
    expect(report.criticalViolation).toBe(true);
    expect(report.violatedRuleIds).toContain('partial_not_marked_full');
  });

  it('does not flag partial-payment language when expectedOutcome is not PARTIAL_PAYMENT', () => {
    const convo = conversation(['Great, so this claim is paid in full then.']);
    const report = runDeterministicChecks(baseScenario({ expectedOutcome: 'CLAIM_PAID' }), convo, {
      ...ROBUSTNESS_EVAL_FIXTURE_VARS,
    });
    expect(report.violatedRuleIds).not.toContain('partial_not_marked_full');
  });

  it('flags an invented reference number not grounded in rep dialogue or fixture data', () => {
    const convo = conversation(['Your reference number is REF-ZZ99999.'], ['Sure, I can help with that.']);
    const report = runDeterministicChecks(baseScenario(), convo, ROBUSTNESS_EVAL_FIXTURE_VARS);
    expect(report.criticalViolation).toBe(true);
    expect(report.violatedRuleIds).toContain('no_invented_values');
  });

  it('does not flag a reference number the rep actually gave, or a fixture-grounded dollar amount', () => {
    const convo = conversation(
      ['Thank you — I have reference REF-SL-88421 noted. To confirm, the total billed was $850.00.'],
      ['Reference number for this call is REF-SL-88421.'],
    );
    const report = runDeterministicChecks(baseScenario(), convo, ROBUSTNESS_EVAL_FIXTURE_VARS);
    expect(report.violatedRuleIds).not.toContain('no_invented_values');
  });

  it('enforces the carrier-refusal protocol when a scenario is tagged as one', () => {
    const scenario = baseScenario({ isCarrierRefusalScenario: true });
    const badConvo = conversation(["Okay, thank you, goodbye."]);
    const badReport = runDeterministicChecks(scenario, badConvo, ROBUSTNESS_EVAL_FIXTURE_VARS);
    expect(badReport.criticalViolation).toBe(true);
    expect(badReport.violatedRuleIds).toContain('carrier_refusal_protocol');

    const goodConvo = conversation(['Before you go, can I get a reference number and your name for this call?']);
    const goodReport = runDeterministicChecks(scenario, goodConvo, ROBUSTNESS_EVAL_FIXTURE_VARS);
    expect(goodReport.violatedRuleIds).not.toContain('carrier_refusal_protocol');
  });

  it('flags a vague non-answer accepted as resolved in a vague/stonewall-tagged scenario', () => {
    const scenario = baseScenario({ category: 'vague_or_stonewall' });
    const convo = conversation(['Yes please note, okay noted, goodbye.']);
    const report = runDeterministicChecks(scenario, convo, ROBUSTNESS_EVAL_FIXTURE_VARS);
    expect(report.criticalViolation).toBe(true);
    expect(report.violatedRuleIds).toContain('vague_not_resolved');
  });

  it('flags CLAIM_PAID declared with no supporting payment evidence from the rep', () => {
    const scenario = baseScenario({ expectedOutcome: 'CLAIM_PAID' });
    const convo = conversation(['Great, so that is resolved.'], ["I'm not sure, let me check on that."]);
    const report = runDeterministicChecks(scenario, convo, ROBUSTNESS_EVAL_FIXTURE_VARS);
    expect(report.criticalViolation).toBe(true);
    expect(report.violatedRuleIds).toContain('resolved_requires_evidence');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Combined pass criteria
// ─────────────────────────────────────────────────────────────────────────────

function fullyPassingJudgment(overrides: Partial<RobustnessJudgment> = {}): RobustnessJudgment {
  return {
    stayedOnTrack: true,
    redirected: true,
    brokeCriticalRule: false,
    brokenRule: null,
    reachedActionableProgress: true,
    finalOutcome: 'NOT_APPLICABLE',
    handoffTarget: 'none',
    referenceNumberCaptured: false,
    repNameCaptured: false,
    requiredFactsCaptured: [],
    prohibitedFactsViolated: [],
    callTerminatedAppropriately: true,
    rationale: 'test',
    ...overrides,
  };
}

const cleanDeterministicReport = { results: [], criticalViolation: false, violatedRuleIds: [] };

describe('computeFinalResult', () => {
  it('passes when every signal is clean', () => {
    const scenario = baseScenario();
    const result = computeFinalResult(scenario, fullyPassingJudgment(), cleanDeterministicReport);
    expect(result.passed).toBe(true);
    expect(result.failureReasons).toEqual([]);
  });

  it('fails when reachedActionableProgress is false even though nothing else is wrong', () => {
    const scenario = baseScenario();
    const result = computeFinalResult(scenario, fullyPassingJudgment({ reachedActionableProgress: false }), cleanDeterministicReport);
    expect(result.passed).toBe(false);
    expect(result.failureReasons.some((r) => r.includes('reachedActionableProgress'))).toBe(true);
  });

  it('fails on a deterministic critical violation even when the judge sees no broken rule', () => {
    const scenario = baseScenario();
    const violated = { results: [], criticalViolation: true, violatedRuleIds: ['no_human_claim'] };
    const result = computeFinalResult(scenario, fullyPassingJudgment({ brokeCriticalRule: false }), violated);
    expect(result.passed).toBe(false);
    expect(result.failureReasons.some((r) => r.includes('deterministic'))).toBe(true);
  });

  it('does not require redirected=true when redirectApplicable is false', () => {
    const scenario = baseScenario({ redirectApplicable: false });
    const result = computeFinalResult(scenario, fullyPassingJudgment({ redirected: false }), cleanDeterministicReport);
    expect(result.passed).toBe(true);
  });

  it('requires redirected=true when redirectApplicable is not explicitly false', () => {
    const scenario = baseScenario({ redirectApplicable: true });
    const result = computeFinalResult(scenario, fullyPassingJudgment({ redirected: false }), cleanDeterministicReport);
    expect(result.passed).toBe(false);
  });

  it('fails when a required fact was not captured', () => {
    const scenario = baseScenario({ requiredFacts: ['DN-47'] });
    const result = computeFinalResult(scenario, fullyPassingJudgment({ requiredFactsCaptured: [] }), cleanDeterministicReport);
    expect(result.passed).toBe(false);
    expect(result.failureReasons.some((r) => r.includes('DN-47'))).toBe(true);
  });

  it('fails when a prohibited fact was stated', () => {
    const scenario = baseScenario({ prohibitedFacts: ['Henderson'] });
    const result = computeFinalResult(
      scenario,
      fullyPassingJudgment({ prohibitedFactsViolated: ['Henderson'] }),
      cleanDeterministicReport,
    );
    expect(result.passed).toBe(false);
  });

  it('fails when the expected outcome does not match the judge-observed outcome', () => {
    const scenario = baseScenario({ expectedOutcome: 'CLAIM_PAID' });
    const result = computeFinalResult(scenario, fullyPassingJudgment({ finalOutcome: 'PARTIAL_PAYMENT' }), cleanDeterministicReport);
    expect(result.passed).toBe(false);
  });

  it('fails when the expected handoff does not match', () => {
    const scenario = baseScenario({ expectedHandoff: 'Resolution_Closer' });
    const result = computeFinalResult(scenario, fullyPassingJudgment({ handoffTarget: 'none' }), cleanDeterministicReport);
    expect(result.passed).toBe(false);
  });

  it('fails when a reference number was required but not captured', () => {
    const scenario = baseScenario({ referenceNumberRequired: true });
    const result = computeFinalResult(scenario, fullyPassingJudgment({ referenceNumberCaptured: false }), cleanDeterministicReport);
    expect(result.passed).toBe(false);
  });

  it('fails when the call was required to terminate but did not', () => {
    const scenario = baseScenario({ mustTerminateCall: true });
    const result = computeFinalResult(scenario, fullyPassingJudgment({ callTerminatedAppropriately: false }), cleanDeterministicReport);
    expect(result.passed).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Report generation (repeated-run reliability, flaky detection, certification)
// ─────────────────────────────────────────────────────────────────────────────

function fakeRun(scenarioId: string, repetitionNumber: number, passed: boolean, critical = false) {
  return {
    scenarioId,
    label: scenarioId,
    conversation: { scenarioId, turns: [] },
    judgment: fullyPassingJudgment({ brokeCriticalRule: critical, stayedOnTrack: !critical || passed }),
    deterministic: { results: [], criticalViolation: critical, violatedRuleIds: critical ? ['no_human_claim'] : [] },
    passed,
    failureReasons: passed ? [] : ['test failure'],
    repetitionNumber,
  };
}

describe('buildEvalReport', () => {
  it('computes pass rate, flaky detection, and release certification across repetitions', () => {
    const scenarioId = CONVERSATION_ROBUSTNESS_SCENARIOS[0].id;
    const runs = [
      fakeRun(scenarioId, 1, true),
      fakeRun(scenarioId, 2, false),
      fakeRun(scenarioId, 3, true),
    ];
    const report = buildEvalReport({
      runs,
      repeatCount: 3,
      runMode: 'recommended',
      agentModel: 'test-model',
      judgeModel: 'test-judge',
      scenariosRequested: [scenarioId],
    });

    const agg = report.scenarioAggregates.find((a) => a.scenarioId === scenarioId)!;
    expect(agg.passCount).toBe(2);
    expect(agg.passRate).toBeCloseTo(2 / 3);
    expect(agg.flaky).toBe(true);
    expect(agg.releaseCertified).toBe(false); // fewer than 5 repetitions
    expect(report.summary.flakyScenarioIds).toContain(scenarioId);
  });

  it('never certifies a scenario with fewer than 5 repetitions, even at 100% pass rate', () => {
    const scenarioId = CONVERSATION_ROBUSTNESS_SCENARIOS[0].id;
    const runs = [fakeRun(scenarioId, 1, true), fakeRun(scenarioId, 2, true)];
    const report = buildEvalReport({
      runs,
      repeatCount: 2,
      runMode: 'custom',
      agentModel: 'test-model',
      judgeModel: 'test-judge',
      scenariosRequested: [scenarioId],
    });
    expect(report.scenarioAggregates[0].releaseCertified).toBe(false);
  });

  it('certifies only at 5+ repetitions with a 100% pass rate and no critical violation', () => {
    const scenarioId = CONVERSATION_ROBUSTNESS_SCENARIOS[0].id;
    const runs = [1, 2, 3, 4, 5].map((n) => fakeRun(scenarioId, n, true));
    const report = buildEvalReport({
      runs,
      repeatCount: 5,
      runMode: 'release',
      agentModel: 'test-model',
      judgeModel: 'test-judge',
      scenariosRequested: [scenarioId],
    });
    expect(report.scenarioAggregates[0].releaseCertified).toBe(true);
    expect(report.summary.releaseCertifiedScenarioIds).toContain(scenarioId);
  });

  it('never certifies a scenario if any repetition has a critical violation, even with a 100% pass rate', () => {
    const scenarioId = CONVERSATION_ROBUSTNESS_SCENARIOS[0].id;
    const runs = [1, 2, 3, 4, 5].map((n) => fakeRun(scenarioId, n, true, n === 3));
    const report = buildEvalReport({
      runs,
      repeatCount: 5,
      runMode: 'release',
      agentModel: 'test-model',
      judgeModel: 'test-judge',
      scenariosRequested: [scenarioId],
    });
    expect(report.scenarioAggregates[0].anyCriticalViolation).toBe(true);
    expect(report.scenarioAggregates[0].releaseCertified).toBe(false);
  });

  it('produces an empty, schema-complete human-review entry per run for a reviewer to fill in', () => {
    const scenarioId = CONVERSATION_ROBUSTNESS_SCENARIOS[0].id;
    const runs = [fakeRun(scenarioId, 1, true)];
    const report = buildEvalReport({
      runs,
      repeatCount: 1,
      runMode: 'local',
      agentModel: 'test-model',
      judgeModel: 'test-judge',
      scenariosRequested: [scenarioId],
    });
    expect(report.humanReview).toHaveLength(1);
    expect(report.humanReview[0]).toMatchObject({
      scenarioId,
      repetitionNumber: 1,
      reviewerAgreement: null,
      falsePositive: null,
      falseNegative: null,
      promptDefect: null,
      scenarioDefect: null,
      productDefect: null,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression comparison between two reports
// ─────────────────────────────────────────────────────────────────────────────

describe('compareReports', () => {
  function report(overrides: Partial<ReturnType<typeof buildEvalReport>>) {
    const scenarioId = CONVERSATION_ROBUSTNESS_SCENARIOS[0].id;
    const base = buildEvalReport({
      runs: [fakeRun(scenarioId, 1, true)],
      repeatCount: 1,
      runMode: 'local',
      agentModel: 'model-a',
      judgeModel: 'judge-a',
      scenariosRequested: [scenarioId],
    });
    return { ...base, ...overrides };
  }

  it('detects a newly failing scenario and a new critical violation', () => {
    const scenarioId = CONVERSATION_ROBUSTNESS_SCENARIOS[0].id;
    const baseline = buildEvalReport({
      runs: [fakeRun(scenarioId, 1, true)],
      repeatCount: 1,
      runMode: 'local',
      agentModel: 'model-a',
      judgeModel: 'judge-a',
      scenariosRequested: [scenarioId],
    });
    const candidate = buildEvalReport({
      runs: [fakeRun(scenarioId, 1, false, true)],
      repeatCount: 1,
      runMode: 'local',
      agentModel: 'model-a',
      judgeModel: 'judge-a',
      scenariosRequested: [scenarioId],
    });

    const comparison = compareReports(baseline, candidate);
    expect(comparison.newlyFailingScenarios).toContain(scenarioId);
    expect(comparison.newCriticalViolations).toContain(scenarioId);
  });

  it('detects a prompt change via the production prompt hash', () => {
    const baseline = report({ productionPromptHash: 'aaa' });
    const candidate = report({ productionPromptHash: 'bbb' });
    expect(compareReports(baseline, candidate).promptChanged).toBe(true);
  });

  it('excludes a scenario from pass/fail comparison when its definition materially changed', () => {
    const scenarioId = CONVERSATION_ROBUSTNESS_SCENARIOS[0].id;
    const baseline = buildEvalReport({
      runs: [fakeRun(scenarioId, 1, false)],
      repeatCount: 1,
      runMode: 'local',
      agentModel: 'model-a',
      judgeModel: 'judge-a',
      scenariosRequested: [scenarioId],
    });
    const candidate = buildEvalReport({
      runs: [fakeRun(scenarioId, 1, true)],
      repeatCount: 1,
      runMode: 'local',
      agentModel: 'model-a',
      judgeModel: 'judge-a',
      scenariosRequested: [scenarioId],
    });
    // Force a changed definition hash on the candidate's aggregate, simulating an edited scenario.
    candidate.scenarioAggregates[0].scenarioDefinitionHash = 'changed-hash';

    const comparison = compareReports(baseline, candidate);
    expect(comparison.scenariosWithChangedDefinition).toContain(scenarioId);
    expect(comparison.newlyPassingScenarios).not.toContain(scenarioId);
  });
});
