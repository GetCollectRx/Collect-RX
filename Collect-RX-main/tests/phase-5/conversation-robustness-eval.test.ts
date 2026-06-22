// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Conversation Robustness Eval (static checks)
//
// These checks run without ANTHROPIC_API_KEY and without network access. They
// validate the scenario library and the Scenario J ("off-script / unexpected
// response") guardrails added to the live Claims_Agent prompt. The full
// live-LLM simulation + judge is run separately via
// `npm run eval:conversation-robustness`.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  CONVERSATION_ROBUSTNESS_SCENARIOS,
  getClaimsAgentPrompt,
  renderTemplate,
  ROBUSTNESS_EVAL_FIXTURE_VARS,
} from '../../src/services/analytics/conversation-robustness-eval';

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
