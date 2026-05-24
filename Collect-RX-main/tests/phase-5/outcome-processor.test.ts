// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Outcome Processor Unit Tests
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { classifyOutcome } from '../../src/outcome/processor';
import type { VapiWebhookPayload } from '../../src/vapi/client';

function makePayload(overrides: Partial<VapiWebhookPayload> = {}): VapiWebhookPayload {
  return {
    type: 'call.ended',
    call: {
      id: 'vapi-call-001',
      status: 'completed',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationSeconds: 300,
    },
    ...overrides,
  };
}

describe('OutcomeProcessor.classifyOutcome', () => {
  it('detects BLOCK_DETECTED on automation language', () => {
    const result = classifyOutcome(makePayload({
      transcript: 'We are unable to process automated calls on this line.',
    }));
    expect(result.outcome).toBe('BLOCK_DETECTED');
    expect(result.carrierBlockDetected).toBe(true);
  });

  it('detects BLOCK_DETECTED — bot activity variant', () => {
    const result = classifyOutcome(makePayload({
      transcript: 'Our system has detected bot activity. Goodbye.',
    }));
    expect(result.outcome).toBe('BLOCK_DETECTED');
    expect(result.carrierBlockDetected).toBe(true);
  });

  it('detects RESOLVED on payment confirmation', () => {
    const result = classifyOutcome(makePayload({
      transcript: 'The claim has been processed and payment was issued on April 15th.',
      analysis: { summary: 'Claim approved. Reference number is SL20241234.' },
    }));
    expect(result.outcome).toBe('RESOLVED');
    expect(result.carrierBlockDetected).toBe(false);
  });

  it('extracts reference number from transcript', () => {
    const result = classifyOutcome(makePayload({
      transcript: 'Your reference number is CL2024987654. The claim has been paid.',
    }));
    expect(result.outcome).toBe('RESOLVED');
    expect(result.referenceNumber).toBeTruthy();
  });

  it('detects DENIED on coverage language', () => {
    const result = classifyOutcome(makePayload({
      transcript: 'The claim has been denied — the procedure is not covered under this plan.',
    }));
    expect(result.outcome).toBe('DENIED');
    expect(result.carrierBlockDetected).toBe(false);
  });

  it('detects PENDING when claim is still processing', () => {
    const result = classifyOutcome(makePayload({
      transcript: 'The claim is currently being reviewed. Please allow 10 business days.',
    }));
    expect(result.outcome).toBe('PENDING');
  });

  it('detects ESCALATED when supervisor mention found', () => {
    const result = classifyOutcome(makePayload({
      transcript: 'I will transfer you to speak with a supervisor about this dispute.',
    }));
    expect(result.outcome).toBe('ESCALATED');
  });

  it('returns FAILED on failed call status', () => {
    const result = classifyOutcome(makePayload({
      call: { id: 'x', status: 'failed', durationSeconds: 0 },
      transcript: '',
    }));
    expect(result.outcome).toBe('FAILED');
    expect(result.carrierBlockDetected).toBe(false);
  });

  it('returns NO_ANSWER for very short calls', () => {
    const result = classifyOutcome(makePayload({
      call: { id: 'x', status: 'completed', durationSeconds: 10 },
      transcript: 'Hello.',
    }));
    expect(result.outcome).toBe('NO_ANSWER');
  });

  it('extracts rep name from transcript', () => {
    const result = classifyOutcome(makePayload({
      transcript: 'Hi, my name is Sarah. The claim has been processed and payment was issued.',
    }));
    expect(result.repName).toBe('Sarah');
  });

  it('BLOCK_DETECTED always sets carrierBlockDetected true', () => {
    const result = classifyOutcome(makePayload({
      transcript: 'This call appears to be automated. Disconnecting.',
    }));
    expect(result.carrierBlockDetected).toBe(true);
    expect(result.outcome).toBe('BLOCK_DETECTED');
  });

  it('detects ESCALATED for x-ray requirement (legacy: xray_required)', () => {
    const result = classifyOutcome(makePayload({
      transcript: 'The claim is on hold until we receive pre-operative x-rays.',
    }));
    expect(result.outcome).toBe('ESCALATED');
    expect(result.outcomeDetail).toContain('xray_required');
  });

  it('detects ESCALATED for documentation required (legacy: docs_required)', () => {
    const result = classifyOutcome(makePayload({
      transcript: 'We need clinical notes before we can adjudicate this claim.',
    }));
    expect(result.outcome).toBe('ESCALATED');
    expect(result.outcomeDetail).toContain('docs_required');
  });

  it('detects ESCALATED when claim not in system (legacy: resubmit_required)', () => {
    const result = classifyOutcome(makePayload({
      transcript: 'That claim is not in our system. You may need to resubmit.',
    }));
    expect(result.outcome).toBe('ESCALATED');
    expect(result.outcomeDetail).toContain('resubmit_required');
  });

  it('detects DENIED for annual maximum (legacy: coverage_maxed)', () => {
    const result = classifyOutcome(makePayload({
      transcript: 'Benefits show the annual maximum has been reached for this patient.',
    }));
    expect(result.outcome).toBe('DENIED');
    expect(result.outcomeDetail).toContain('coverage_maxed');
  });

  it('detects BLOCK_DETECTED for legacy carrier block phrase', () => {
    const result = classifyOutcome(makePayload({
      transcript: 'Please do not call again from this number.',
    }));
    expect(result.outcome).toBe('BLOCK_DETECTED');
    expect(result.carrierBlockDetected).toBe(true);
    expect(result.outcomeDetail).toContain('carrier_block');
  });

  it('classifies from summary when transcript is empty (legacy uses both)', () => {
    const result = classifyOutcome(makePayload({
      transcript: '',
      analysis: { summary: 'Carrier requires radiographs before payment.' },
      call: { id: 'vapi-call-001', status: 'completed', durationSeconds: 120 },
    }));
    expect(result.outcome).toBe('ESCALATED');
    expect(result.outcomeDetail).toContain('xray_required');
  });
});
