import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClientErrorMessage, apiErrorMessageForResponse } from '../src/server/apiErrorMessage.js';

describe('apiErrorMessage', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('hides server error details in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(apiErrorMessageForResponse(new Error('relation "secret" does not exist'))).toBe(
      'Internal server error',
    );
  });

  it('exposes server error details in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(apiErrorMessageForResponse(new Error('dev only'))).toBe('dev only');
  });

  it('hides client error details in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(apiClientErrorMessage(new Error('Stripe: card declined'))).toBe('Request could not be completed');
  });
});
