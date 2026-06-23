// ─────────────────────────────────────────────────────────────────────────────
// PHIPA-oriented audit for PHI encrypt/decrypt operations.
//
// Logs: operation, record identifier, optional actor/practice, timestamp.
// Never logs decrypted plaintext, ciphertext, IV, or auth tags.
// ─────────────────────────────────────────────────────────────────────────────

import { logLine } from '../observability/logger.js';

export type PhiCryptoOperation = 'encrypt' | 'decrypt';
export type PhiCryptoOutcome = 'success' | 'failure';

export interface PhiCryptoAuditFields {
  operation: PhiCryptoOperation;
  outcome: PhiCryptoOutcome;
  /** Stable opaque id for the record (e.g. UUID primary key, token id). */
  recordId: string;
  /** Logical field or column name, e.g. patientPhone — not the value. */
  fieldKey?: string;
  practiceId?: string;
  /** Authenticated subject or service principal (opaque id or role label). */
  actor?: string;
  correlationId?: string;
  /** Machine-readable failure reason when outcome is failure — not exception text with PHI. */
  errorCode?: string;
}

/**
 * Emit one structured audit line per encrypt/decrypt invocation (success or failure).
 */
export function logPhiCryptoAccess(fields: PhiCryptoAuditFields): void {
  const {
    operation,
    outcome,
    recordId,
    fieldKey,
    practiceId,
    actor,
    correlationId,
    errorCode,
  } = fields;

  logLine('info', 'PHI_CRYPTO_ACCESS', {
    event: 'PHI_CRYPTO_ACCESS',
    operation,
    outcome,
    recordId,
    ...(fieldKey !== undefined ? { fieldKey } : {}),
    ...(practiceId !== undefined ? { practiceId } : {}),
    ...(actor !== undefined ? { actor } : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
    ...(errorCode !== undefined ? { errorCode } : {}),
  });
}
