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
  getClaimsAgentPrompt,
  renderTemplate,
  ROBUSTNESS_EVAL_FIXTURE_VARS,
} from '../../src/services/analytics/conversation-robustness-eval';

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
