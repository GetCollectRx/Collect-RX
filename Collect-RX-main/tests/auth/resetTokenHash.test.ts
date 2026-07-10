import { describe, expect, it } from 'vitest';
import {
  generatePasswordResetToken,
  hashPasswordResetToken,
} from '../../src/server/auth/resetTokenHash.js';

describe('password reset token hashing', () => {
  it('hashes tokens deterministically with SHA-256 hex', () => {
    const plain = 'abc123';
    expect(hashPasswordResetToken(plain)).toHaveLength(64);
    expect(hashPasswordResetToken(plain)).toBe(hashPasswordResetToken(plain));
  });

  it('generates 64-char hex tokens', () => {
    const t = generatePasswordResetToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });
});
