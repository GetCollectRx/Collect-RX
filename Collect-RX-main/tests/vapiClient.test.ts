import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VapiCallParams } from '../src/vapi/client.js';
import { CARRIER_PHONE_MAP, initiateCall, initiatePreVisitCall, VapiAmbiguousOutcomeError } from '../src/vapi/client.js';
import preVisitSquadConfig from '../vapi-previsit-config.json';

// Distinctive sentinels so a "PHI must not appear here" assertion can only pass
// because the value is genuinely absent, never because the fixture omitted it.
const PHI_SENTINELS = {
  patientName: 'Jane Q Sentinel',
  patientDob: '1974-03-22',
  policyNumber: 'POL-SENTINEL-8891',
  subscriberName: 'John Q Sentinel',
} as const;

const BASE_PARAMS: VapiCallParams = {
  claimId: 'claim-1',
  carrierId: 'sun_life' as const,
  practiceId: 'practice-1',
  patientToken: '00000000-0000-0000-0000-000000000000',
  patientName: PHI_SENTINELS.patientName,
  patientDob: PHI_SENTINELS.patientDob,
  policyNumber: PHI_SENTINELS.policyNumber,
  subscriberName: PHI_SENTINELS.subscriberName,
  carrierPhone: CARRIER_PHONE_MAP.sun_life,
  claimNumber: 'CLM-100',
  daysOutstanding: 45,
  billedAmount: 250,
  outstandingAmount: 100,
  practiceName: 'Downtown Dental',
  providerNumber: 'ON-123456',
  practicePhone: '416-555-0100',
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

  it('keeps PHI out of Vapi metadata and confines it to ephemeral call variables', async () => {
    await initiateCall(BASE_PARAMS);

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    const { metadata, variableValues } = body.assistantOverrides;

    // Positive control: the PHI really is in this payload, so the absence
    // assertions below are proving a boundary rather than an empty fixture.
    expect(variableValues.patient_name).toBe(PHI_SENTINELS.patientName);
    expect(variableValues.patient_dob).toBe(PHI_SENTINELS.patientDob);
    expect(variableValues.policy_number).toBe(PHI_SENTINELS.policyNumber);

    // metadata carries UUID/reference keys only — PHIPA/PIPEDA boundary.
    expect(Object.keys(metadata).sort()).toEqual(
      ['carrierId', 'claimId', 'patientToken', 'practiceId'],
    );
    const serialisedMetadata = JSON.stringify(metadata);
    for (const phi of Object.values(PHI_SENTINELS)) {
      expect(serialisedMetadata).not.toContain(phi);
    }

    // Nothing PHI-bearing may ride outside assistantOverrides either.
    expect(JSON.stringify(body.customer ?? {})).not.toContain(PHI_SENTINELS.patientName);
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

  it('never sets disclosure_message — PreVisit_IVR_Navigator.firstMessage is a literal "" in vapi-previsit-config.json and must not be able to speak a disclosure via a variable', async () => {
    await initiatePreVisitCall(PRE_VISIT_BASE);

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.assistantOverrides.variableValues.disclosure_message).toBeUndefined();
    // The disclosure text lives only in PreVisit_Agent's hardcoded firstMessage
    // template; call_purpose supplies just the reason-for-call clause.
    expect(body.assistantOverrides.variableValues.call_purpose).toBe(
      'an eligibility and coverage verification before a scheduled appointment',
    );
  });

  it('uses the CDCP-specific call purpose when cdcpContext is true', async () => {
    await initiatePreVisitCall({ ...PRE_VISIT_BASE, cdcpContext: true });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.assistantOverrides.variableValues.call_purpose).toBe(
      'a CDCP predetermination status inquiry before a scheduled appointment',
    );
  });
});

describe('vapi-previsit-config.json — PreVisit_IVR_Navigator must never speak', () => {
  function findMember(name: string) {
    const member = (preVisitSquadConfig.squad.members as Array<{ assistant: { name: string } }>).find(
      (m) => m.assistant.name === name,
    );
    if (!member) throw new Error(`squad member "${name}" not found`);
    return member.assistant;
  }

  it('PreVisit_IVR_Navigator.firstMessage is a literal empty string, not a variable', () => {
    const navigator = findMember('PreVisit_IVR_Navigator');
    expect(navigator.firstMessage).toBe('');
    expect(navigator.firstMessageMode).toBe('assistant-waits-for-user');
  });

  it('PreVisit_Agent carries the real disclosure text, not a bare variable reference', () => {
    const agent = findMember('PreVisit_Agent');
    expect(agent.firstMessage).toContain('automated calling system');
    expect(agent.firstMessage).toContain('{{practice_name}}');
    expect(agent.firstMessage).toContain('{{call_purpose}}');
  });
});
