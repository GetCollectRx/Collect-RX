// ─────────────────────────────────────────────────────────────────────────────
// High-level PHI encrypt/decrypt with mandatory PHIPA-style audit logging.
// Prefer this module over calling phiAesGcm directly from route handlers.
// ─────────────────────────────────────────────────────────────────────────────

import {
  decryptPhi,
  encryptPhi,
  type EncryptedPhiField,
  type EncryptedPhiPayloadV1,
  fromEncryptedPayloadV1,
  toEncryptedPayloadV1,
} from './phiAesGcm.js';
import { logPhiCryptoAccess } from './phiCryptoAudit.js';
import { requirePhiEncryptionKey } from './phiEncryptionKey.js';

export type { EncryptedPhiField, EncryptedPhiPayloadV1 } from './phiAesGcm.js';
export { toEncryptedPayloadV1, fromEncryptedPayloadV1 } from './phiAesGcm.js';

export interface PhiAtRestAuditContext {
  recordId: string;
  fieldKey?: string;
  practiceId?: string;
  actor?: string;
  correlationId?: string;
}

function auditEncryptSuccess(ctx: PhiAtRestAuditContext): void {
  logPhiCryptoAccess({
    operation: 'encrypt',
    outcome: 'success',
    recordId: ctx.recordId,
    fieldKey: ctx.fieldKey,
    practiceId: ctx.practiceId,
    actor: ctx.actor,
    correlationId: ctx.correlationId,
  });
}

function auditDecryptSuccess(ctx: PhiAtRestAuditContext): void {
  logPhiCryptoAccess({
    operation: 'decrypt',
    outcome: 'success',
    recordId: ctx.recordId,
    fieldKey: ctx.fieldKey,
    practiceId: ctx.practiceId,
    actor: ctx.actor,
    correlationId: ctx.correlationId,
  });
}

function auditDecryptFailure(ctx: PhiAtRestAuditContext, errorCode: string): void {
  logPhiCryptoAccess({
    operation: 'decrypt',
    outcome: 'failure',
    recordId: ctx.recordId,
    fieldKey: ctx.fieldKey,
    practiceId: ctx.practiceId,
    actor: ctx.actor,
    correlationId: ctx.correlationId,
    errorCode,
  });
}

export function encryptPhiAtRest(plaintext: string, ctx: PhiAtRestAuditContext): EncryptedPhiField {
  const key = requirePhiEncryptionKey();
  const out = encryptPhi(plaintext, key);
  auditEncryptSuccess(ctx);
  return out;
}

export function decryptPhiAtRest(blob: EncryptedPhiField, ctx: PhiAtRestAuditContext): string {
  const key = requirePhiEncryptionKey();
  try {
    const plain = decryptPhi(blob, key);
    auditDecryptSuccess(ctx);
    return plain;
  } catch {
    auditDecryptFailure(ctx, 'DECRYPT_FAILED');
    throw new Error('[phiAtRest] decrypt failed (wrong key, corrupt data, or tampered ciphertext)');
  }
}

export function encryptPhiAtRestToPayloadV1(
  plaintext: string,
  ctx: PhiAtRestAuditContext,
): EncryptedPhiPayloadV1 {
  return toEncryptedPayloadV1(encryptPhiAtRest(plaintext, ctx));
}

export function decryptPhiAtRestFromPayloadV1(
  payload: EncryptedPhiPayloadV1,
  ctx: PhiAtRestAuditContext,
): string {
  return decryptPhiAtRest(fromEncryptedPayloadV1(payload), ctx);
}
