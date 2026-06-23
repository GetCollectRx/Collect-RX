import { describe, expect, it } from 'vitest';
import {
  isDatabaseUnavailableError,
  isReasonableUnsubscribeEmail,
  isValidPatientBalanceId,
  isValidPublicPayToken,
  publicPayJsonError,
} from '../src/server/publicApiHelpers.js';

describe('publicApiHelpers', () => {
  it('accepts 32-char hex pay tokens only', () => {
    expect(isValidPublicPayToken('a'.repeat(32))).toBe(true);
    expect(isValidPublicPayToken('nonexistent-token-for-tests')).toBe(false);
    expect(isValidPublicPayToken('')).toBe(false);
  });

  it('validates patient balance UUID for unsubscribe', () => {
    expect(isValidPatientBalanceId('00000000-0000-4000-8000-000000000000')).toBe(true);
    expect(isValidPatientBalanceId('not-a-uuid')).toBe(false);
  });

  it('rejects unreasonable unsubscribe emails', () => {
    expect(isReasonableUnsubscribeEmail('a@b.co')).toBe(true);
    expect(isReasonableUnsubscribeEmail('not-an-email')).toBe(false);
    expect(isReasonableUnsubscribeEmail('x'.repeat(300))).toBe(false);
  });

  it('maps database unavailable to 503', () => {
    const err = Object.assign(new Error("Can't reach database server"), {
      name: 'PrismaClientInitializationError',
    });
    expect(isDatabaseUnavailableError(err)).toBe(true);
    const mapped = publicPayJsonError(err);
    expect(mapped.status).toBe(503);
    expect(mapped.body.error).toMatch(/temporarily unavailable/i);
  });

  it('maps other errors to 500', () => {
    const mapped = publicPayJsonError(new Error('unexpected'));
    expect(mapped.status).toBe(500);
  });
});
