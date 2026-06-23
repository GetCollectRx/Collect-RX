// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — AES-256-GCM for PHI at rest (application layer)
//
// NIST-recommended 96-bit IV for GCM; authenticated encryption (privacy + integrity).
// Uses Node.js crypto only — do not roll custom primitives.
// ─────────────────────────────────────────────────────────────────────────────

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const PHI_AES_ALGORITHM = 'aes-256-gcm' as const;
/** NIST recommendation for GCM nonce length */
export const PHI_AES_IV_LENGTH = 12;
export const PHI_AES_AUTH_TAG_LENGTH = 16;
export const PHI_AES_KEY_LENGTH = 32;

export interface EncryptedPhiField {
  iv: string;
  encryptedText: string;
  authTag: string;
}

export const PHI_ENCRYPTED_PAYLOAD_VERSION = 1 as const;

/** Serializable blob for Json columns or TEXT (JSON.stringify). */
export interface EncryptedPhiPayloadV1 {
  v: typeof PHI_ENCRYPTED_PAYLOAD_VERSION;
  iv: string;
  encryptedText: string;
  authTag: string;
}

export function assertAes256Key(secretKey: Buffer): void {
  if (!Buffer.isBuffer(secretKey) || secretKey.length !== PHI_AES_KEY_LENGTH) {
    throw new Error(
      `[phiAesGcm] secret key must be a Buffer of exactly ${PHI_AES_KEY_LENGTH} bytes (AES-256)`,
    );
  }
}

/**
 * Encrypt UTF-8 plaintext. Random IV per call (required for GCM nonce uniqueness).
 */
export function encryptPhi(plaintext: string, secretKey: Buffer): EncryptedPhiField {
  assertAes256Key(secretKey);
  const iv = randomBytes(PHI_AES_IV_LENGTH);
  const cipher = createCipheriv(PHI_AES_ALGORITHM, secretKey, iv, { authTagLength: PHI_AES_AUTH_TAG_LENGTH });

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    iv: iv.toString('hex'),
    encryptedText: encrypted,
    authTag,
  };
}

export function decryptPhi(encryptedData: EncryptedPhiField, secretKey: Buffer): string {
  assertAes256Key(secretKey);
  const iv = Buffer.from(encryptedData.iv, 'hex');
  const authTag = Buffer.from(encryptedData.authTag, 'hex');

  const decipher = createDecipheriv(PHI_AES_ALGORITHM, secretKey, iv, {
    authTagLength: PHI_AES_AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedData.encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function toEncryptedPayloadV1(e: EncryptedPhiField): EncryptedPhiPayloadV1 {
  return { v: PHI_ENCRYPTED_PAYLOAD_VERSION, ...e };
}

export function fromEncryptedPayloadV1(p: EncryptedPhiPayloadV1): EncryptedPhiField {
  if (p.v !== PHI_ENCRYPTED_PAYLOAD_VERSION) {
    throw new Error(`[phiAesGcm] unsupported payload version: ${String(p.v)}`);
  }
  return { iv: p.iv, encryptedText: p.encryptedText, authTag: p.authTag };
}
