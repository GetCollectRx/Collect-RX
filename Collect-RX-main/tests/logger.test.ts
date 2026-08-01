import { describe, it, expect } from 'vitest';
import logger from '../src/logger.cjs';

// scrubPhi is exposed only as logger._scrubPhi for this test — see logger.cjs.
const scrubPhi = (logger as unknown as { _scrubPhi: (meta: unknown) => Record<string, unknown> })
  ._scrubPhi;

describe('logger scrubPhi — Error serialization (AA-10)', () => {
  it('preserves message and stack for a nested Error (the queueEngine.ts logger.error(msg, { error: err }) pattern)', () => {
    const err = new Error('Vapi dispatch failed: 503 upstream unavailable');
    const scrubbed = scrubPhi({ claimId: 'claim-1', error: err });

    expect(scrubbed.error).not.toEqual({});
    expect(scrubbed.error).toMatchObject({
      name: 'Error',
      message: 'Vapi dispatch failed: 503 upstream unavailable',
    });
    expect((scrubbed.error as { stack?: string }).stack).toContain('Error: Vapi dispatch failed');
  });

  it('still redacts a PHI-pattern-looking error message', () => {
    const err = new Error('lookup failed for John Smith');
    const scrubbed = scrubPhi({ error: err });

    expect((scrubbed.error as { message: string }).message).toBe('[REDACTED-PATTERN]');
  });

  it('preserves the error name for non-Error subclasses (e.g. TypeError)', () => {
    const err = new TypeError('Cannot read properties of undefined');
    const scrubbed = scrubPhi({ error: err });

    expect((scrubbed.error as { name: string }).name).toBe('TypeError');
  });

  it('still redacts known PHI field names', () => {
    const scrubbed = scrubPhi({ patient_name: 'Jane Doe', claimId: 'claim-1' });
    expect(scrubbed.patient_name).toBe('[REDACTED-PHI]');
    expect(scrubbed.claimId).toBe('claim-1');
  });

  it('still redacts PHI-pattern-looking plain string values', () => {
    const scrubbed = scrubPhi({ note: 'DOB on file: 2001-03-15' });
    expect(scrubbed.note).toBe('[REDACTED-PATTERN]');
  });

  it('still recurses into plain nested objects', () => {
    const scrubbed = scrubPhi({ context: { patient_name: 'Jane Doe', claimId: 'claim-1' } });
    expect(scrubbed.context).toEqual({ patient_name: '[REDACTED-PHI]', claimId: 'claim-1' });
  });
});
