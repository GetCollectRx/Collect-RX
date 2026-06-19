import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CARRIER_PHONE_MAP, initiateCall } from '../src/vapi/client.js';

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
    delete process.env.VAPI_PHONE_NUMBER_ID;
  });

  it('forwards practiceName and providerNumber as IVR context variables', async () => {
    await initiateCall(BASE_PARAMS);

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);

    expect(body.variables.practiceName).toBe('Downtown Dental');
    expect(body.variables.providerNumber).toBe('ON-123456');
  });

  it('refuses to dial a number that is not a known carrier claims line', async () => {
    await expect(
      initiateCall({ ...BASE_PARAMS, carrierPhone: '+15555555555' }),
    ).rejects.toThrow(/known carrier claims line/);

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
