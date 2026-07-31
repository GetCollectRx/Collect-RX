import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  assertAllowedEvalModel,
  assertAnthropicEvalAllowed,
  isAnthropicEvalAllowed,
} from '../src/services/analytics/anthropicEvalGuard.js';

describe('anthropicEvalGuard', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to disabled', () => {
    expect(isAnthropicEvalAllowed()).toBe(false);
    expect(() => assertAnthropicEvalAllowed('Test')).toThrow(/disabled/);
  });

  it('allows when COLLECTRX_ANTHROPIC_EVAL=1', () => {
    vi.stubEnv('COLLECTRX_ANTHROPIC_EVAL', '1');
    expect(isAnthropicEvalAllowed()).toBe(true);
    expect(() => assertAnthropicEvalAllowed('Test')).not.toThrow();
  });

  it('blocks Opus models in eval tooling', () => {
    expect(() => assertAllowedEvalModel('claude-opus-4-8', 'Test')).toThrow(/not allowed/);
    expect(() => assertAllowedEvalModel('claude-sonnet-4-6', 'Test')).not.toThrow();
    expect(() => assertAllowedEvalModel('claude-haiku-4-5-20251001', 'Test')).not.toThrow();
  });
});
