import { describe, expect, it } from 'vitest';
import {
  isDatabaseUnavailableError,
  isReasonableUnsubscribeEmail,
  isValidPublicUuid,
  publicJsonError,
} from '../src/server/publicApiHelpers.js';

describe('publicApiHelpers', () => {
  it('validates public UUIDs', () => {
    expect(isValidPublicUuid('00000000-0000-4000-8000-000000000000')).toBe(true);
    expect(isValidPublicUuid('not-a-uuid')).toBe(false);
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
    const mapped = publicJsonError(err, 'Service is temporarily unavailable', 'Failed');
    expect(mapped.status).toBe(503);
    expect(mapped.body.error).toMatch(/temporarily unavailable/i);
  });

  it('maps other errors to 500', () => {
    const mapped = publicJsonError(new Error('unexpected'), 'unavailable', 'Failed');
    expect(mapped.status).toBe(500);
    expect(mapped.body.error).toBe('Failed');
  });
});
