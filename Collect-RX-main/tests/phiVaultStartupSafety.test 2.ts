import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertPersistentPhiVaultConfigured } from '../src/server/crypto/phiEncryptionKey.js';

describe('persisted PHI vault startup safety', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ['missing key', ''],
    ['invalid key', 'not-a-32-byte-key'],
  ])('rejects production startup with a %s', (_case, key) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PHI_ENCRYPTION_KEY', key);

    expect(assertPersistentPhiVaultConfigured).toThrow(/PHI_ENCRYPTION_KEY is missing or invalid/);
  });

  it('accepts a valid production vault key', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PHI_ENCRYPTION_KEY', 'a'.repeat(64));

    expect(assertPersistentPhiVaultConfigured).not.toThrow();
  });
});
