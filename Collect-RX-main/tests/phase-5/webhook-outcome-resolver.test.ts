import { describe, expect, it } from 'vitest';
import type { VapiWebhookPayload } from '../../src/vapi/client';
import {
  extractStructuredClaimStatus,
  resolveOutcomeFromWebhookPayload,
} from '../../src/outcome/webhookOutcomeResolver';

function baseCall(): VapiWebhookPayload['call'] {
  return { id: 'call-1', status: 'completed', durationSeconds: 60 };
}

/** Minimal metadata so tests satisfy VapiCallMetadata while exercising collectrx. */
function meta(collectrx: NonNullable<VapiWebhookPayload['metadata']>['collectrx']) {
  return {
    claimId: 'c1',
    carrierId: 'sun_life',
    patientToken: 'pt',
    practiceId: 'pr1',
    collectrx,
  } satisfies NonNullable<VapiWebhookPayload['metadata']>;
}

describe('webhookOutcomeResolver', () => {
  it('uses metadata.collectrx when schemaVersion is 1 and callOutcome is valid', () => {
    const payload: VapiWebhookPayload = {
      type: 'call.ended',
      call: baseCall(),
      transcript: 'Claim has been processed and payment issued.', // would classify as RESOLVED
      metadata: meta({
        schemaVersion: 1,
        callOutcome: 'DENIED',
        outcomeDetail: 'Carrier denied via structured payload',
        carrierBlockDetected: false,
      }),
    };
    const out = resolveOutcomeFromWebhookPayload(payload);
    expect(out.outcome).toBe('DENIED');
    expect(out.outcomeDetail).toBe('Carrier denied via structured payload');
    expect(out.carrierBlockDetected).toBe(false);
  });

  it('reads structured block from analysis.collectrx', () => {
    const payload: VapiWebhookPayload = {
      type: 'call.ended',
      call: baseCall(),
      transcript: 'nothing special',
      analysis: {
        collectrx: {
          schemaVersion: 1,
          callOutcome: 'BLOCK_DETECTED',
          outcomeDetail: 'IVR flagged automation',
          carrierBlockDetected: true,
        },
      },
    };
    const out = resolveOutcomeFromWebhookPayload(payload);
    expect(out.outcome).toBe('BLOCK_DETECTED');
    expect(out.carrierBlockDetected).toBe(true);
  });

  it('falls back to classifyOutcome when collectrx is missing or schemaVersion !== 1', () => {
    const transcript = 'The claim has been denied — not covered under this plan.';
    const noStructured: VapiWebhookPayload = {
      type: 'call.ended',
      call: baseCall(),
      transcript,
    };
    expect(resolveOutcomeFromWebhookPayload(noStructured).outcome).toBe('DENIED');

    const wrongVersion: VapiWebhookPayload = {
      type: 'call.ended',
      call: baseCall(),
      transcript,
      metadata: meta({ schemaVersion: 2 as 1, callOutcome: 'PENDING' }),
    };
    expect(resolveOutcomeFromWebhookPayload(wrongVersion).outcome).toBe('DENIED');
  });

  it('extractStructuredClaimStatus returns claimStatus when valid', () => {
    const payload: VapiWebhookPayload = {
      type: 'call.ended',
      call: baseCall(),
      metadata: meta({
        schemaVersion: 1,
        callOutcome: 'RESOLVED',
        claimStatus: 'APPROVED_PENDING_PAYMENT',
      }),
    };
    expect(extractStructuredClaimStatus(payload)).toBe('APPROVED_PENDING_PAYMENT');
  });

  it('extractStructuredClaimStatus returns null for invalid or absent claimStatus', () => {
    expect(
      extractStructuredClaimStatus({
        type: 'call.ended',
        call: baseCall(),
        metadata: meta({ schemaVersion: 1, callOutcome: 'RESOLVED' }),
      }),
    ).toBeNull();

    expect(
      extractStructuredClaimStatus({
        type: 'call.ended',
        call: baseCall(),
        metadata: meta({
          schemaVersion: 1,
          callOutcome: 'RESOLVED',
          claimStatus: 'BLOCKED' as 'RESOLVED',
        }),
      }),
    ).toBeNull();
  });
});
