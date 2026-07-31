/**
 * Gate for any CollectRx code path that bills the Anthropic API console directly.
 *
 * Default: OFF. Live LLM evals must not run because ANTHROPIC_API_KEY exists in the
 * shell — that caused ~$56/week Opus spend from agent loops and CLI tools.
 *
 * Enable only for intentional, manual eval runs:
 *   COLLECTRX_ANTHROPIC_EVAL=1 npm run eval:conversation-robustness
 *
 * Free validation (no API): npm test, npm run agents
 */

const OPUS_PATTERN = /^claude-opus/i;

export function isAnthropicEvalAllowed(): boolean {
  return process.env.COLLECTRX_ANTHROPIC_EVAL === '1';
}

export function assertAnthropicEvalAllowed(context: string): void {
  if (!isAnthropicEvalAllowed()) {
    throw new Error(
      `[${context}] Live Anthropic API calls are disabled. ` +
        'Set COLLECTRX_ANTHROPIC_EVAL=1 only when you intend to pay for an eval run. ' +
        'Use `npm test` and `npm run agents` for free validation.',
    );
  }
}

/** Block Opus in dev/eval tooling — production Vapi squads are configured separately. */
export function assertAllowedEvalModel(model: string, context: string): void {
  if (OPUS_PATTERN.test(model)) {
    throw new Error(
      `[${context}] Model "${model}" is not allowed for CollectRx API eval tooling. Use Haiku or Sonnet.`,
    );
  }
}
