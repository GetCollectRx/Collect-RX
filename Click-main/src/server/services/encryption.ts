/**
 * AES-256-GCM encryption service for PHI at rest.
 *
 * Usage:
 *   const { ciphertext, iv, tag } = encrypt('sensitive data');
 *   const plaintext = decrypt(ciphertext, iv, tag);
 *
 * The ENCRYPTION_KEY env var must be a 64-char hex string (32 bytes).
 * Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

import crypto from 'crypto';

const ALGORITHM  = 'aes-256-gcm';
const IV_LENGTH  = 16; // 128-bit IV
const TAG_LENGTH = 16; // 128-bit auth tag

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ENCRYPTION_KEY must be a 64-char hex string in production');
    }
    // Dev fallback — deterministic but insecure; warns loudly
    console.warn(
      '⚠️  ENCRYPTION_KEY not set. Using dev fallback key — NEVER use in production.'
    );
    return Buffer.from('0'.repeat(64), 'hex');
  }
  return Buffer.from(hex, 'hex');
}

export interface EncryptedValue {
  ciphertext: string; // hex
  iv        : string; // hex
  tag       : string; // hex
}

export function encrypt(plaintext: string): EncryptedValue {
  const key = getKey();
  const iv  = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString('hex'),
    iv        : iv.toString('hex'),
    tag       : tag.toString('hex'),
  };
}

export function decrypt(ciphertext: string, iv: string, tag: string): string {
  const key = getKey();

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, 'hex'),
    { authTagLength: TAG_LENGTH }
  );
  decipher.setAuthTag(Buffer.from(tag, 'hex'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'hex')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

// ── Convenience: serialize encrypted value to a single DB-storable string ────
// Format: <iv_hex>:<tag_hex>:<ciphertext_hex>

export function encryptToString(plaintext: string): string {
  const { ciphertext, iv, tag } = encrypt(plaintext);
  return `${iv}:${tag}:${ciphertext}`;
}

export function decryptFromString(encoded: string): string {
  const parts = encoded.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted string format');
  const [iv, tag, ciphertext] = parts;
  return decrypt(ciphertext, iv, tag);
}

// ── Hash utilities (for non-reversible fields like SSN last-4) ───────────────

export function hashPhi(value: string): string {
  const salt = process.env.PHI_HASH_SALT || 'dev-salt-change-in-prod';
  return crypto.createHmac('sha256', salt).update(value).digest('hex');
}
