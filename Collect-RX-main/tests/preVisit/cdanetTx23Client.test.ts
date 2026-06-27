import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { submitTx23Inquiry } from '../../src/server/preVisit/cdanetTx23Client.js';

describe('submitTx23Inquiry', () => {
  beforeEach(() => {
    delete process.env.ITRANS2_ENDPOINT;
    delete process.env.ITRANS2_SITE_ID;
    delete process.env.ITRANS2_SOFTWARE_ID;
    delete process.env.ITRANS2_CLIENT_CERT_PATH;
    delete process.env.ITRANS2_CLIENT_CERT_PEM;
    delete process.env.ITRANS2_LIVE;
    delete process.env.ITRANS2_TEST_PASSED;
    delete process.env.ITRANS2_TEST_MODE;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns unresolved when ITRANS2 is not configured', async () => {
    const result = await submitTx23Inquiry({
      providerNumber: 'ON-123',
      memberId: 'M1',
      groupNumber: 'G1',
      procedureCodes: ['D2750'],
    });
    expect(result.resolved).toBe(false);
    expect(result.reason).toBe('itrans_unconfigured');
  });

  it('parses gateway response when configured', async () => {
    process.env.ITRANS2_ENDPOINT = 'https://gateway.test';
    process.env.ITRANS2_SITE_ID = 'site-1';
    process.env.ITRANS2_SOFTWARE_ID = 'sw-1';
    process.env.ITRANS2_CLIENT_CERT_PEM = 'test-cert';
    process.env.ITRANS2_TEST_PASSED = '1';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          eligibilityStatus: 'eligible',
          predeterminationStatus: 'approved',
        }),
      }),
    );

    const result = await submitTx23Inquiry({
      providerNumber: 'ON-123',
      memberId: 'M1',
      groupNumber: 'G1',
      procedureCodes: ['D2750'],
    });

    expect(result.resolved).toBe(true);
    expect(result.eligibilityStatus).toBe('eligible');
    expect(result.predeterminationStatus).toBe('approved');
  });
});
