/**
 * PHI / Vapi boundary — src/vapi/client.ts `initiateCall()`.
 *
 * PHIPA/PIPEDA-critical rule (docs/compliance/PHI-VAPI-BOUNDARY.md): patient name, DOB,
 * and policy number must only ever leave the backend as ephemeral Vapi call `variables`.
 * The persisted `metadata` field must contain a UUID token only — never real PHI.
 *
 * No DB required — `fetch` is stubbed, so this suite runs regardless of Postgres
 * availability (unlike the other workflow test files in this directory).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CarrierId } from '@prisma/client';
import { initiateCall, CARRIER_PHONE_MAP, type VapiCallParams } from '../src/vapi/client.js';

const ENV_BACKUP = { ...process.env };

function baseParams(overrides: Partial<VapiCallParams> = {}): VapiCallParams {
  return {
    claimId: 'claim-e2e-1',
    carrierId: 'sun_life' as CarrierId,
    practiceId: 'practice-e2e-1',
    patientToken: 'a1b2c3d4-e5f6-uuid-token',
    patientName: 'Jane Q. Doe',
    patientDob: '1985-06-12',
    policyNumber: 'POL-99999',
    subscriberName: 'John Doe',
    subscriberDob: '1980-01-01',
    relationship: 'spouse',
    carrierPhone: CARRIER_PHONE_MAP.sun_life,
    claimNumber: 'CLM-E2E-1001',
    groupNumber: 'GRP-1',
    treatmentDate: '2026-02-15',
    claimSubmittedDate: '2026-02-20',
    daysOutstanding: 45,
    billedAmount: 450,
    outstandingAmount: 450,
    treatmentCodes: 'D1110',
    practiceName: 'Fixture Dental',
    providerNumber: 'PN-1',
    practicePhone: '+15551234567',
    ...overrides,
  };
}

describe('PHI / Vapi metadata boundary — initiateCall()', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ENV_BACKUP };
  });

  it('places the patient UUID token (and only the token) in metadata — PHI goes only in ephemeral variables', async () => {
    process.env.VAPI_API_KEY = 'test-key';
    process.env.VAPI_SQUAD_ID = 'squad-test';
    process.env.VAPI_PHONE_NUMBER_ID = 'phone-test';

    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        capturedBody = JSON.parse(String(init.body));
        return {
          ok: true,
          json: async () => ({ id: 'call-123', status: 'queued', createdAt: new Date().toISOString() }),
        } as Response;
      }),
    );

    const result = await initiateCall(baseParams());
    expect(result.vapiCallId).toBe('call-123');
    expect(capturedBody).toBeDefined();

    // metadata: UUID primary key only — lives under assistantOverrides per Vapi CreateCallDTO.
    const overrides = capturedBody!.assistantOverrides as Record<string, unknown>;
    expect(overrides.metadata).toEqual({
      claimId: 'claim-e2e-1',
      carrierId: 'sun_life',
      patientToken: 'a1b2c3d4-e5f6-uuid-token',
      practiceId: 'practice-e2e-1',
    });
    const metadataStr = JSON.stringify(overrides.metadata);
    expect(metadataStr).not.toMatch(/Jane/);
    expect(metadataStr).not.toMatch(/1985-06-12/);
    expect(metadataStr).not.toMatch(/POL-99999/);

    // variables: the ephemeral PHI carrier.
    const variables = overrides.variableValues as Record<string, string>;
    expect(variables.patient_name).toBe('Jane Q. Doe');
    expect(variables.patient_dob).toBe('1985-06-12');
    expect(variables.policy_number).toBe('POL-99999');
    expect(variables.subscriber_name).toBe('John Doe');
  });

  it('refuses to dial a phone number that is not a known carrier claims line, and never calls out', async () => {
    process.env.VAPI_API_KEY = 'test-key';
    process.env.VAPI_SQUAD_ID = 'squad-test';
    process.env.VAPI_PHONE_NUMBER_ID = 'phone-test';

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      initiateCall(baseParams({ carrierPhone: '+15005550006' })),
    ).rejects.toThrow(/not a known carrier claims line/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
