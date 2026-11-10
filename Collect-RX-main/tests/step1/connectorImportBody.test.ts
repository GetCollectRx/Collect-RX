// The desktop connector declares the practice's payer program explicitly; with
// nothing configured it sends none, and the server rejects new claims.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { buildClaimsImportBody, readDefaultPayerType } = require('../../desktop/services/claimsImportBody.cjs') as {
  buildClaimsImportBody: (rows: unknown[], env: Record<string, string | undefined>) => Record<string, unknown>;
  readDefaultPayerType: (env: Record<string, string | undefined>) => string | undefined;
};

describe('connector claims import body', () => {
  it('sends no payer type when none is configured (no silent default)', () => {
    const body = buildClaimsImportBody([{ a: 1 }], {});
    expect(body).toEqual({ records: [{ a: 1 }], pmsVendor: 'abeldent', pmsSource: 'abeldent' });
    expect(body).not.toHaveProperty('defaultPayerType');
  });
  it.each(['PRIVATE', 'private', ' Cdcp ', 'PROVINCIAL'])('sends the configured program (%s) normalized', (raw) => {
    expect(buildClaimsImportBody([], { COLLECTRX_DEFAULT_PAYER_TYPE: raw }).defaultPayerType).toBe(raw.trim().toUpperCase());
  });
  it('fails loudly on an unrecognized value instead of guessing', () => {
    expect(() => readDefaultPayerType({ COLLECTRX_DEFAULT_PAYER_TYPE: 'medicare' })).toThrow(/must be PRIVATE, CDCP or PROVINCIAL/);
  });
});
