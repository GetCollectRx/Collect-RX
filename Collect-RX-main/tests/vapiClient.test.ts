import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CARRIER_PHONE_MAP, initiateCall, initiatePreVisitCall, VapiAmbiguousOutcomeError } from '../src/vapi/client.js';

const BASE_PARAMS = {
  claimId: 'claim-1',
  carrierId: 'sun_life' as const,
  practiceId: 'practice-1',
  patientToken: '00000000-0000-0000-0000-000000000000',
  carrierPhone: CARRIER_PHONE_MAP.sun_life,
  claimNumber: 'CLM-100',
  billedAmount: 250,
  outstandingAmount: 100,
  practiceName: 'Downtown Dental',
  providerNumber: 'ON-123456',
};

describe('initiateCall', () => {
  beforeEach(() => {
    process.env.VAPI_API_KEY = 'test-key';
    process.env.VAPI_SQUAD_ID = 'squad-1';
    process.env.VAPI_PHONE_NUMBER_ID = 'phone-1';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ vapiCallId: 'call-1', status: 'queued', createdAt: '2026-06-15T00:00:00.000Z' }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.VAPI_API_KEY;
    delete process.env.VAPI_SQUAD_ID;
    delete process.env.VAPI_PREVISIT_SQUAD_ID;
    delete process.env.VAPI_PHONE_NUMBER_ID;
  });

  it('forwards practiceName and providerNumber as IVR context variables', async () => {
    await initiateCall(BASE_PARAMS);

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);

    // CreateCallDTO has no top-level variables/metadata/recordingEnabled —
    // everything call-scoped must ride in assistantOverrides.
    expect(body.variables).toBeUndefined();
    expect(body.metadata).toBeUndefined();
    expect(body.recordingEnabled).toBeUndefined();
    expect(body.assistantOverrides.variableValues.practice_name).toBe('Downtown Dental');
    expect(body.assistantOverrides.variableValues.provider_number).toBe('ON-123456');
    expect(body.assistantOverrides.metadata.practiceId).toBeDefined();
    expect(body.assistantOverrides.artifactPlan.recordingEnabled).toBe(false);
  });

  it('refuses to dial a number that is not a known carrier claims line', async () => {
    await expect(
      initiateCall({ ...BASE_PARAMS, carrierPhone: '+15555555555' }),
    ).rejects.toThrow(/known carrier claims line/);

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the Idempotency-Key header when idempotencyKey is provided', async () => {
    await initiateCall({ ...BASE_PARAMS, idempotencyKey: 'claim-1:1' });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('claim-1:1');
  });

  it('omits the Idempotency-Key header when none is provided', async () => {
    await initiateCall(BASE_PARAMS);

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBeUndefined();
  });

  it('throws VapiAmbiguousOutcomeError (not a plain Error) when fetch itself throws — timeout/network failure, no response received', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError')),
    );

    await expect(initiateCall(BASE_PARAMS)).rejects.toBeInstanceOf(VapiAmbiguousOutcomeError);
  });

  it('throws a plain Error (not ambiguous) when Vapi responds with a non-2xx status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => 'invalid payload' }),
    );

    await expect(initiateCall(BASE_PARAMS)).rejects.not.toBeInstanceOf(VapiAmbiguousOutcomeError);
    await expect(initiateCall(BASE_PARAMS)).rejects.toThrow(/422/);
  });
});

const PRE_VISIT_BASE = {
  practiceId: 'practice-1',
  patientToken: '00000000-0000-0000-0000-000000000000',
  carrierId: 'sun_life' as const,
  appointmentVerificationId: 'verification-1',
  preVisitType: 'eligibility' as const,
  patientName: 'Jane Doe',
  patientDob: '1990-01-01',
  policyNumber: 'POL-1',
  procedureCodes: ['D1110'],
  appointmentAt: '2026-06-28T15:00:00.000Z',
  practiceName: 'Downtown Dental',
  providerNumber: 'ON-123456',
  practicePhone: '416-555-0100',
};

describe('initiatePreVisitCall', () => {
  beforeEach(() => {
    process.env.VAPI_API_KEY = 'test-key';
    process.env.VAPI_SQUAD_ID = 'squad-recovery';
    process.env.VAPI_PHONE_NUMBER_ID = 'phone-1';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ vapiCallId: 'call-pre-1', status: 'queued', createdAt: '2026-06-15T00:00:00.000Z' }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.VAPI_API_KEY;
    delete process.env.VAPI_SQUAD_ID;
    delete process.env.VAPI_PREVISIT_SQUAD_ID;
    delete process.env.VAPI_PHONE_NUMBER_ID;
  });

  it('uses VAPI_PREVISIT_SQUAD_ID when set', async () => {
    process.env.VAPI_PREVISIT_SQUAD_ID = 'squad-previsit';
    await initiatePreVisitCall(PRE_VISIT_BASE);

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.squadId).toBe('squad-previsit');
  });

  it('falls back to VAPI_SQUAD_ID when pre-visit squad is unset', async () => {
    await initiatePreVisitCall(PRE_VISIT_BASE);

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.squadId).toBe('squad-recovery');
  });
});
