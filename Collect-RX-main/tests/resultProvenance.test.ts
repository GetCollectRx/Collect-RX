import { describe, expect, it } from 'vitest';
import { deriveResultProvenance } from '../src/server/resultProvenance.js';

const base = {
  usedHumanLog: false,
  hasStructuredPayload: false,
  referenceNumber: null,
  heldForHumanVerification: false,
};

describe('deriveResultProvenance', () => {
  it('rates a human witnessed log HIGH', () => {
    expect(deriveResultProvenance({ ...base, usedHumanLog: true })).toEqual({
      source: 'HUMAN_LOG',
      confidence: 'HIGH',
    });
  });

  it('prefers the human log over a structured payload', () => {
    const r = deriveResultProvenance({ ...base, usedHumanLog: true, hasStructuredPayload: true });
    expect(r.source).toBe('HUMAN_LOG');
  });

  it('rates a structured payload HIGH', () => {
    expect(deriveResultProvenance({ ...base, hasStructuredPayload: true })).toEqual({
      source: 'STRUCTURED_PAYLOAD',
      confidence: 'HIGH',
    });
  });

  it('rates a classifier result MEDIUM only with a reference number', () => {
    expect(deriveResultProvenance({ ...base, referenceNumber: 'REF-1234' }).confidence).toBe('MEDIUM');
    expect(deriveResultProvenance({ ...base, referenceNumber: '  12 ' }).confidence).toBe('LOW');
    expect(deriveResultProvenance(base)).toEqual({
      source: 'TRANSCRIPT_CLASSIFIER',
      confidence: 'LOW',
    });
  });

  it('forces LOW when the financial gate held the result', () => {
    const r = deriveResultProvenance({
      ...base,
      hasStructuredPayload: true,
      heldForHumanVerification: true,
    });
    expect(r).toEqual({ source: 'STRUCTURED_PAYLOAD', confidence: 'LOW' });
  });
});
