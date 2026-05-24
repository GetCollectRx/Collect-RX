import { describe, expect, it } from 'vitest';
import { validateCsvUploadFile } from '../src/server/validation/csvUpload.js';

describe('validateCsvUploadFile', () => {
  it('rejects missing file', () => {
    const r = validateCsvUploadFile(undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it('rejects disallowed extension', () => {
    const r = validateCsvUploadFile({
      buffer: Buffer.from('a,b'),
      size: 3,
      originalname: 'data.exe',
      mimetype: 'application/octet-stream',
    });
    expect(r.ok).toBe(false);
  });

  it('accepts csv', () => {
    const r = validateCsvUploadFile({
      buffer: Buffer.from('a,b\n1,2'),
      size: 6,
      originalname: 'balances.csv',
      mimetype: 'text/csv',
    });
    expect(r.ok).toBe(true);
  });
});
