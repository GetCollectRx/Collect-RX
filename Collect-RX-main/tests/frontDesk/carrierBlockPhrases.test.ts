import { describe, expect, it } from 'vitest';
import {
  matchedCarrierBlockPhrase,
  transcriptSignalsCarrierBlock,
} from '../../src/server/frontDesk/carrierBlockPhrases.js';

describe('carrier block phrase detection', () => {
  it('detects automation signals', () => {
    expect(transcriptSignalsCarrierBlock('This sounds like a bot call')).toBe(true);
    expect(matchedCarrierBlockPhrase('fraud detection triggered')).toBe('fraud detection');
  });

  it('detects the exact refusal phrases Claims_Agent is instructed to hand off on', () => {
    expect(transcriptSignalsCarrierBlock("Sorry, we don't work with robots.")).toBe(true);
    expect(matchedCarrierBlockPhrase("I'm ending this call now.")).toBe("i'm ending this call");
  });

  it('ignores normal carrier speech', () => {
    expect(transcriptSignalsCarrierBlock('Your claim is pending adjudication')).toBe(false);
  });

  it('does not treat generic IVR wording as a carrier block', () => {
    expect(transcriptSignalsCarrierBlock(
      'Welcome to the automated IVR system. Say claims to continue through the menu.',
    )).toBe(false);
  });
});
