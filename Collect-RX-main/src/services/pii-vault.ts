// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — PIIVault
//
// PHI boundary enforcer. All patient identifiers (names, DOBs, health card
// numbers) are tokenized to UUIDs before leaving this layer. The UUID tokens
// are the ONLY patient identifiers that ever reach Vapi voice agents or are
// stored in insurance_claims / call_attempts / call_queue tables.
//
// Detokenization happens ONLY on the backend after call completion — never
// in transit to Vapi, and never stored back into the call-related tables.
//
// PHIPA/PIPEDA compliance depends on this boundary being inviolable.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PatientPHI {
  patientId: string;       // practice-system patient ID
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;    // ISO date YYYY-MM-DD
  healthCardNumber?: string;
  subscriberId?: string;
  groupNumber?: string;
}

export interface TokenRecord {
  token: string;           // UUID
  patientId: string;       // original practice patient ID
  createdAt: Date;
  expiresAt: Date | null;
}

// ---------------------------------------------------------------------------
// In-memory token store
//
// Production note: swap this for an encrypted PostgreSQL table or a KMS-backed
// store. The in-memory map works for dev/pilot and is intentionally simple.
// All tokens expire after TOKEN_TTL_MS to bound PHI exposure window.
// ---------------------------------------------------------------------------

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** token UUID → { patientId, expiresAt } */
const tokenStore = new Map<string, { patientId: string; expiresAt: Date }>();

/** patientId → token UUID (so the same patient always gets the same token per call) */
const reverseStore = new Map<string, string>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Issue a UUID token for a patient ID.
 *
 * Safe to call repeatedly for the same patientId — returns the same token
 * if it hasn't expired yet (stable within a call session).
 *
 * @param patientId - The practice-system patient identifier.
 * @returns UUID token safe to pass to Vapi / store in DB tables.
 */
export function tokenize(patientId: string): string {
  if (!patientId || typeof patientId !== 'string') {
    throw new Error('[PIIVault] tokenize: patientId must be a non-empty string');
  }

  // Return existing live token if available
  const existingToken = reverseStore.get(patientId);
  if (existingToken) {
    const record = tokenStore.get(existingToken);
    if (record && record.expiresAt > new Date()) {
      return existingToken;
    }
    // Expired — clean up and re-issue
    tokenStore.delete(existingToken);
    reverseStore.delete(patientId);
  }

  const token = randomUUID();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  tokenStore.set(token, { patientId, expiresAt });
  reverseStore.set(patientId, token);

  return token;
}

/**
 * Resolve a UUID token back to the original patient ID.
 *
 * MUST only be called on the backend after call completion — never pass
 * detokenized PHI to Vapi or store it in call-related DB columns.
 *
 * @param token - UUID previously issued by `tokenize()`.
 * @returns The original patientId string.
 * @throws If the token is unknown or expired.
 */
export function detokenize(token: string): string {
  if (!token || typeof token !== 'string') {
    throw new Error('[PIIVault] detokenize: token must be a non-empty string');
  }

  const record = tokenStore.get(token);

  if (!record) {
    throw new Error(`[PIIVault] detokenize: unknown token "${token}"`);
  }

  if (record.expiresAt < new Date()) {
    tokenStore.delete(token);
    reverseStore.delete(record.patientId);
    throw new Error(`[PIIVault] detokenize: token "${token}" has expired`);
  }

  return record.patientId;
}

/**
 * Explicitly revoke a token before its TTL expires.
 * Call after call completion when the token is no longer needed.
 */
export function revoke(token: string): void {
  const record = tokenStore.get(token);
  if (record) {
    reverseStore.delete(record.patientId);
    tokenStore.delete(token);
  }
}

/**
 * Check whether a token is currently valid (exists and not expired).
 */
export function isValid(token: string): boolean {
  const record = tokenStore.get(token);
  return !!record && record.expiresAt > new Date();
}

/**
 * Purge all expired tokens. Call periodically (e.g., on server boot + hourly).
 */
export function purgeExpired(): number {
  const now = new Date();
  let purged = 0;
  for (const [token, record] of tokenStore.entries()) {
    if (record.expiresAt < now) {
      reverseStore.delete(record.patientId);
      tokenStore.delete(token);
      purged++;
    }
  }
  return purged;
}

// ---------------------------------------------------------------------------
// Singleton export (DI-friendly)
// ---------------------------------------------------------------------------

export const piiVault = {
  tokenize,
  detokenize,
  revoke,
  isValid,
  purgeExpired,
} as const;

export default piiVault;
