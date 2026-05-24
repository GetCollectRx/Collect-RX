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

  it('ignores normal carrier speech', () => {
    expect(transcriptSignalsCarrierBlock('Your claim is pending adjudication')).toBe(false);
  });
});
