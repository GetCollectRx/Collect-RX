/**
 * CARRIER_BLOCK detection — found and broadened during pre-pilot validation (2026-08-09).
 *
 * `classifyOutcome()` (src/outcome/processor.ts) detects a carrier block via a fixed
 * regex/phrase list (BLOCK_SIGNAL_PATTERNS + LEGACY_CARRIER_BLOCK_INCLUDES). That list
 * is inherently incomplete — a carrier rep can phrase a block in wording nobody's seen
 * yet — so this stays a living list, not a closed problem. The five phrasings below were
 * the first gap found; patterns were added to catch them and their close variants. This
 * file is meant to keep growing as new real-world phrasing surfaces.
 */
import { describe, expect, it } from 'vitest';
import { classifyOutcome } from '../src/outcome/processor.js';
import type { VapiWebhookPayload } from '../src/vapi/client.js';

function payloadWithTranscript(transcript: string): VapiWebhookPayload {
  return {
    type: 'call.ended',
    call: { id: 'call-1', status: 'ended', durationSeconds: 90 },
    transcript,
    analysis: { summary: '', successEvaluation: '' },
  };
}

describe('CARRIER_BLOCK detection — covered phrasing (control, should pass today)', () => {
  it.each([
    'we are unable to process automated calls at this time',
    'this number has been flagged for review',
    'I detected bot activity on this line',
  ])('detects a known block phrase: "%s"', (phrase) => {
    const result = classifyOutcome(payloadWithTranscript(`Rep: ${phrase}.`));
    expect(result.carrierBlockDetected).toBe(true);
  });
});

describe('FIXED: previously-missed carrier block phrasing is now caught', () => {
  it.each([
    "we're going to have to end this call, our system doesn't allow automated dialers",
    "I need to transfer this to our fraud and security team before we continue",
    "our compliance team has asked us not to speak with auto-dialers going forward",
    "I can tell this isn't a real person calling, so I can't help you today",
    'please remove this line from your calling system, we will not answer again',
  ])('detects: "%s"', (phrase) => {
    const result = classifyOutcome(payloadWithTranscript(`Rep: ${phrase}.`));
    expect(result.carrierBlockDetected).toBe(true);
  });
});

describe('Still worth watching — variants not yet covered (informational, not asserted red)', () => {
  it.each([
    'we have flagged this line as suspicious and are escalating internally',
    'our vendor risk team is reviewing all calls from this number',
  ])('may or may not be caught today — no pattern claims to cover it: "%s"', (phrase) => {
    // Not asserted either way — recorded here as a reminder that this list is never
    // "done." If a future change happens to start catching these, that's a bonus, not
    // a requirement; if it doesn't, that's expected and not a regression.
    classifyOutcome(payloadWithTranscript(`Rep: ${phrase}.`));
  });
});
