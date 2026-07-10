import { createHash, randomBytes } from 'node:crypto';

/** SHA-256 hex digest — stored in DB instead of the raw reset token. */
export function hashPasswordResetToken(plainToken: string): string {
  return createHash('sha256').update(plainToken, 'utf8').digest('hex');
}

export function generatePasswordResetToken(): string {
  return randomBytes(32).toString('hex');
}
