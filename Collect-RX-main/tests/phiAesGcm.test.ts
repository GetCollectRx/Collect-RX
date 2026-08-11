import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptPhi,
  encryptPhi,
  fromEncryptedPayloadV1,
  toEncryptedPayloadV1,
} from '../src/server/crypto/phiAesGcm';

describe('phiAesGcm', () => {
  const key = randomBytes(32);

  it('roundtrips utf-8 plaintext', () => {
    const plain = 'Patient: 例えテスト — O\'Brien';
    const enc = encryptPhi(plain, key);
    expect(enc.iv).toHaveLength(24);
    expect(enc.authTag).toHaveLength(32);
    expect(decryptPhi(enc, key)).toBe(plain);
  });

  it('rejects wrong key length', () => {
    expect(() => encryptPhi('x', Buffer.alloc(16))).toThrow(/32 bytes/);
  });

  it('payload v1 roundtrips', () => {
    const enc = encryptPhi('secret', key);
    const payload = toEncryptedPayloadV1(enc);
    expect(payload.v).toBe(1);
    expect(decryptPhi(fromEncryptedPayloadV1(payload), key)).toBe('secret');
  });
});
