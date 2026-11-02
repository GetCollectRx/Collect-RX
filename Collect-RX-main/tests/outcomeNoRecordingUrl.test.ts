import { describe, expect, it } from 'vitest';
import { classifyOutcome } from '../src/outcome/processor.js';
import { resolveOutcomeFromWebhookPayload } from '../src/outcome/webhookOutcomeResolver.js';
import type { VapiWebhookPayload } from '../src/vapi/client.js';

const RECORDING = 'https://storage.vapi.ai/recording-secret.wav';

function payload(overrides: Partial<VapiWebhookPayload> = {}): VapiWebhookPayload {
  return {
    type: 'call.ended',
    call: { id: 'call-1', status: 'ended', durationSeconds: 90 },
    transcript: 'Rep: Your claim was paid in full, reference number ABC12345.',
    recordingUrl: RECORDING,
    ...overrides,
  };
}

// The zero-retention PHI boundary deletes vendor audio after each call, so a
// processed outcome must never carry the recording URL toward durable storage.
describe('processed outcomes never carry the recording URL', () => {
  it('classifyOutcome drops recordingUrl', () => {
    const processed = classifyOutcome(payload());
    expect(JSON.stringify(processed)).not.toContain(RECORDING);
    expect(processed).not.toHaveProperty('transcriptUrl');
  });

  it('resolveOutcomeFromWebhookPayload drops recordingUrl on the structured path', () => {
    const processed = resolveOutcomeFromWebhookPayload(
      payload({
        metadata: undefined,
        analysis: { collectrx: { schemaVersion: 1, callOutcome: 'RESOLVED' } },
      }),
    );
    expect(JSON.stringify(processed)).not.toContain(RECORDING);
    expect(processed).not.toHaveProperty('transcriptUrl');
  });
});
