import { describe, expect, it } from 'vitest';
import { normalizeVapiWebhook } from '../src/webhooks/vapiNormalizer.js';

const METADATA = {
  claimId: 'claim-1',
  carrierId: 'canada_life',
  patientToken: 'token-1',
  practiceId: 'practice-1',
};

function liveTranscript(overrides: Record<string, unknown> = {}) {
  return {
    message: {
      type: 'transcript',
      role: 'user',
      transcriptType: 'final',
      transcript: 'We do not accept automated calls. I am ending this call.',
      call: {
        id: 'vapi-call-live-1',
        assistantOverrides: { metadata: METADATA },
      },
      ...overrides,
    },
  };
}

describe('normalizeVapiWebhook: live transcript messages', () => {
  it('maps a final carrier-side transcript to the internal transcript shape', () => {
    const normalized = normalizeVapiWebhook(liveTranscript());
    expect(normalized).not.toBeNull();
    expect(normalized?.type).toBe('transcript');
    expect(normalized?.call.id).toBe('vapi-call-live-1');
    expect(normalized?.transcript).toBe('We do not accept automated calls. I am ending this call.');
    expect(normalized?.metadata?.practiceId).toBe('practice-1');
  });

  it('drops partial transcripts so each utterance is handled once, when final', () => {
    expect(normalizeVapiWebhook(liveTranscript({ transcriptType: 'partial' }))).toBeNull();
  });

  it('drops our own assistant speech so it is never attributed to the carrier', () => {
    expect(normalizeVapiWebhook(liveTranscript({ role: 'assistant' }))).toBeNull();
  });

  it('drops transcript messages with no text', () => {
    expect(normalizeVapiWebhook(liveTranscript({ transcript: '' }))).toBeNull();
    expect(normalizeVapiWebhook(liveTranscript({ transcript: undefined }))).toBeNull();
  });

  it('drops transcript messages with no call id', () => {
    const body = liveTranscript();
    (body.message as { call: unknown }).call = {};
    expect(normalizeVapiWebhook(body)).toBeNull();
  });
});
