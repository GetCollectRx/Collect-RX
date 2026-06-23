import { describe, expect, it, afterEach } from 'vitest';
import {
  isPhiEncryptionAtRestEnabled,
  parsePhiEncryptionKeyFromEnv,
} from '../src/server/crypto/phiEncryptionKey';

describe('phiEncryptionKey', () => {
  afterEach(() => {
    delete process.env.PHI_ENCRYPTION_KEY;
    delete process.env.PHI_ENCRYPTION_AT_REST;
  });

  it('parses 64 hex chars as 32-byte key', () => {
    const hex = 'a'.repeat(64);
    process.env.PHI_ENCRYPTION_KEY = hex;
    const buf = parsePhiEncryptionKeyFromEnv();
    expect(buf?.length).toBe(32);
  });

  it('parses base64 of 32 bytes', () => {
    process.env.PHI_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    expect(parsePhiEncryptionKeyFromEnv()?.length).toBe(32);
  });

  it('returns null for invalid key', () => {
    process.env.PHI_ENCRYPTION_KEY = 'tooshort';
    expect(parsePhiEncryptionKeyFromEnv()).toBeNull();
  });

  it('detects PHI_ENCRYPTION_AT_REST flag', () => {
    process.env.PHI_ENCRYPTION_AT_REST = '1';
    expect(isPhiEncryptionAtRestEnabled()).toBe(true);
    process.env.PHI_ENCRYPTION_AT_REST = 'false';
    expect(isPhiEncryptionAtRestEnabled()).toBe(false);
  });
});
