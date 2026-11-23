import { describe, it, expect } from 'vitest';
import { resolveStaffHandoffWithoutLog } from '../src/outcome/humanAssistedOutcomeResolver.js';
import { redactPhiPatterns } from '../src/services/guardrails/transcriptRedaction.js';

const payloadOutcome = (carrierBlockDetected: boolean) =>
  ({
    outcome: 'PAID',
    outcomeDetail: 'inferred from IVR audio',
    repName: 'Someone',
    referenceNumber: 'REF1',
    transcriptUrl: null,
    durationSeconds: 10,
    carrierBlockDetected,
  }) as any;

describe('resolveStaffHandoffWithoutLog', () => {
  it('escalates instead of trusting the IVR/hold payload', () => {
    const r = resolveStaffHandoffWithoutLog(payloadOutcome(false), {
      transcriptUrl: 'u',
      durationSeconds: 42,
    });
    expect(r.structuredClaimStatus).toBe('ESCALATED');
    expect(r.processed.outcome).not.toBe('PAID');
    expect(r.processed.repName).toBeNull();
    expect(r.processed.referenceNumber).toBeNull();
    expect(r.processed.durationSeconds).toBe(42);
  });

  it('keeps carrier block detection from the payload', () => {
    const r = resolveStaffHandoffWithoutLog(payloadOutcome(true), {
      transcriptUrl: null,
      durationSeconds: null,
    });
    expect(r.processed.carrierBlockDetected).toBe(true);
  });
});

describe('narrative scrub', () => {
  it('redacts 10-digit numbers and dates in free text', () => {
    const out = redactPhiPatterns('Patient DOB 1980-05-12, phone 6135018951');
    expect(out).not.toContain('6135018951');
    expect(out).not.toContain('1980-05-12');
  });
});
