/**
 * CARRIER_BLOCK detection — known gap found during pre-pilot validation (2026-08-09).
 *
 * `classifyOutcome()` (src/outcome/processor.ts) detects a carrier block via a fixed
 * regex/phrase list (BLOCK_SIGNAL_PATTERNS + LEGACY_CARRIER_BLOCK_INCLUDES). That list
 * is necessarily incomplete — a carrier rep can phrase a block in wording that was never
 * observed and added to the list, and calls will keep going out to a carrier that has
 * already flagged automation. This is the single most operationally dangerous gap in the
 * pipeline per CLAUDE.md's own framing ("the most critical operational safety rule").
 *
 * These tests are RED by design: they demonstrate real-sounding block phrasing that a
 * carrier rep could plausibly say, which the current classifier does NOT catch.
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

describe('GAP: plausible carrier block phrasing NOT on the fixed pattern list goes undetected', () => {
  it.each([
    "we're going to have to end this call, our system doesn't allow automated dialers",
    "I need to transfer this to our fraud and security team before we continue",
    "our compliance team has asked us not to speak with auto-dialers going forward",
    "I can tell this isn't a real person calling, so I can't help you today",
    'please remove this line from your calling system, we will not answer again',
  ])('MISSES: "%s"', (phrase) => {
    const result = classifyOutcome(payloadWithTranscript(`Rep: ${phrase}.`));
    // GAP: carrierBlockDetected is false here even though a human operator would
    // immediately recognize this as the carrier objecting to automation. In production
    // this means calls keep dispatching to a carrier that has already objected, until
    // (if ever) this exact wording gets manually added to BLOCK_SIGNAL_PATTERNS.
    expect(result.carrierBlockDetected).toBe(false);
  });
});
