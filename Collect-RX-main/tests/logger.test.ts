import { describe, it, expect } from 'vitest';
import { safeMeta } from '../src/server/observability/logger.js';

// Regression coverage for AA-10 (PHI leaking through unstructured Error
// logging), ported from the retired src/logger.cjs onto the consolidated
// observability/logger.ts. safeMetaValue() special-cases `instanceof Error`
// before the generic object-recursion branch — Error.message/.stack are
// non-enumerable, so Object.entries() (what plain recursion does) silently
// returned {} for any Error value, the exact bug this guards against.
describe('safeMeta — Error serialization (AA-10)', () => {
  it('preserves message and stack for a nested Error (the logger.warn(msg, { cause: err }) pattern)', () => {
    const err = new Error('Vapi dispatch failed: 503 upstream unavailable');
    const scrubbed = safeMeta({ claimId: 'claim-1', cause: err });

    expect(scrubbed?.cause).not.toEqual({});
    expect(scrubbed?.cause).toMatchObject({
      name: 'Error',
      message: 'Vapi dispatch failed: 503 upstream unavailable',
    });
    expect((scrubbed?.cause as { stack?: string }).stack).toContain('Error: Vapi dispatch failed');
  });

  it('redacts an email address inside an Error message', () => {
    const err = new Error('lookup failed for jane.doe@example.com');
    const scrubbed = safeMeta({ cause: err });

    expect((scrubbed?.cause as { message: string }).message).toBe(
      'lookup failed for [redacted:email]',
    );
  });

  it('preserves the error name for non-Error subclasses (e.g. TypeError)', () => {
    const err = new TypeError('Cannot read properties of undefined');
    const scrubbed = safeMeta({ cause: err });

    expect((scrubbed?.cause as { name: string }).name).toBe('TypeError');
  });

  it('still redacts known PHI field names', () => {
    const scrubbed = safeMeta({ patientName: 'Jane Doe', claimId: 'claim-1' });
    expect(scrubbed?.patientName).toBe('[redacted:phi]');
    expect(scrubbed?.claimId).toBe('claim-1');
  });

  it('still redacts an ISO date inside a plain string value', () => {
    const scrubbed = safeMeta({ note: 'DOB on file: 2001-03-15' });
    expect(scrubbed?.note).toBe('DOB on file: [redacted:date]');
  });

  it('still recurses into plain nested objects', () => {
    const scrubbed = safeMeta({ context: { patientName: 'Jane Doe', claimId: 'claim-1' } });
    expect(scrubbed?.context).toEqual({ patientName: '[redacted:phi]', claimId: 'claim-1' });
  });
});
