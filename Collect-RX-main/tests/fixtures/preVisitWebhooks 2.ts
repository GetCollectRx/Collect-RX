/**
 * Synthetic VAPI webhook payloads for pre-visit verification tests.
 * All patient tokens and claim refs are fictional — no real PHI.
 */
import type { VapiWebhookPayload } from '../../src/vapi/client.js';

const BASE_META = {
  practiceId: 'practice-fixture',
  patientToken: '00000000-0000-4000-8000-00000000a001',
  carrierId: 'sun_life' as const,
  preVisitType: 'cdcp_predet' as const,
  cdcpContext: true,
  appointmentVerificationId: 'verification-fixture',
  claim_ref: 'PD-FIXTURE-001',
  procedure_code: 'D2750',
};

export function buildPreVisitApprovedPayload(
  overrides: Partial<VapiWebhookPayload> & { call?: Partial<VapiWebhookPayload['call']> } = {},
): VapiWebhookPayload {
  const callId = overrides.call?.id ?? 'vapi-previsit-approved-fixture';
  return {
    type: 'call.ended',
    call: {
      id: callId,
      status: 'completed',
      durationSeconds: 312,
      endedAt: new Date().toISOString(),
      ...overrides.call,
    },
    metadata: {
      ...BASE_META,
      ...overrides.metadata,
    },
    analysis: {
      structuredData: {
        predetermination_status: 'approved',
        eligibility_status: 'eligible',
        outcome: 'APPROVED',
        claim_ref: 'PD-FIXTURE-001',
        procedure_code: 'D2750',
        practice_id: BASE_META.practiceId,
        patient_token: BASE_META.patientToken,
        carrier_code: 'cdcp_sunlife',
        is_appealable: 'false',
      },
      ...(overrides.analysis ?? {}),
    },
    ...overrides,
  } as VapiWebhookPayload;
}

export function buildPreVisitDeniedPayload(
  overrides: Partial<VapiWebhookPayload> & { call?: Partial<VapiWebhookPayload['call']> } = {},
): VapiWebhookPayload {
  const callId = overrides.call?.id ?? 'vapi-previsit-denied-fixture';
  return {
    type: 'call.ended',
    call: {
      id: callId,
      status: 'completed',
      durationSeconds: 428,
      endedAt: new Date().toISOString(),
      ...overrides.call,
    },
    metadata: {
      ...BASE_META,
      ...overrides.metadata,
    },
    analysis: {
      structuredData: {
        predetermination_status: 'denied',
        eligibility_status: 'eligible',
        outcome: 'DENIED',
        reason_code: 'F-010',
        denial_reason_text: 'Missing periapical radiograph for crown predetermination',
        claim_ref: 'PD-FIXTURE-DENIED',
        predetermination_ref: 'PD-FIXTURE-DENIED',
        procedure_code: 'D2750',
        practice_id: BASE_META.practiceId,
        patient_token: BASE_META.patientToken,
        carrier_code: 'cdcp_sunlife',
        is_appealable: 'true',
      },
      ...(overrides.analysis ?? {}),
    },
    ...overrides,
  } as VapiWebhookPayload;
}

export function buildPreVisitCallFailedPayload(
  attemptCount = 1,
  overrides: Partial<VapiWebhookPayload> = {},
): VapiWebhookPayload {
  return {
    type: 'call.failed',
    call: {
      id: 'vapi-previsit-failed-fixture',
      status: 'failed',
      endedAt: new Date().toISOString(),
    },
    metadata: {
      ...BASE_META,
      appointmentVerificationId: 'verification-fixture',
      ...overrides.metadata,
    },
    analysis: {
      structuredData: {
        outcome: 'NO_ANSWER',
      },
    },
    ...overrides,
    // attemptCount is read from DB row, not payload — tests set verification.attemptCount
    _fixtureAttemptCount: attemptCount,
  } as VapiWebhookPayload & { _fixtureAttemptCount?: number };
}
