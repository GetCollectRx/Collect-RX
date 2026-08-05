// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Call Engine Tokenization Facade
//
// PHI BOUNDARY (read before touching this file): this module does NOT implement
// a second PHI store. `src/pii-vault.ts` (PIIVault) is the single, AES-256-GCM
// encrypted, tenant-scoped vault — its own header states plainly that
// "PHIPA/PIPEDA compliance depends on this boundary being respected" and that
// it is the one place PHI is tokenized. A second token map — even a well-
// intentioned local one — is a compliance regression: two vaults means two
// places a bug can leak PHI, and no single audit trail.
//
// What this file adds is a narrow, intention-revealing surface for the call
// engine's two PHI operations:
//   1. tokenize PHI once, when a claim is queued (never re-derive from the PMS)
//   2. detokenize immediately before dispatch, never before, never logged
//
// See docs/compliance/PHI-VAPI-BOUNDARY.md for the full Option B decision
// record (ephemeral PHI in Vapi call `variables`, UUID tokens only in
// `metadata`). If this API doesn't cover a need, extend PIIVault — don't
// route around it with a parallel implementation.
// ─────────────────────────────────────────────────────────────────────────────

import { piiVault, type PatientPHI } from '../../pii-vault';

export type { PatientPHI };

/** Thrown when a token cannot be resolved back to PHI — never contains PHI itself. */
export class CallEngineTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CallEngineTokenError';
  }
}

export interface TokenizeOptions {
  /** Tenant boundary — tokens are practice-scoped in PIIVault. */
  practiceId: string;
  /** Human-readable source for the audit log, e.g. "pmsImportPipeline.upsertClaim". */
  callerContext: string;
}

export interface DetokenizeOptions extends TokenizeOptions {
  ipAddress?: string;
}

/**
 * Issue a UUID token for patient PHI. Call once, at import/queue time — the
 * returned token is what gets stored on `InsuranceClaim.patientToken` and
 * carried in Vapi `metadata`. Never call this per-dial; PIIVault already
 * returns the same live token for a given PHI record's `tokenize()` call.
 */
export function tokenizePatientPHI(phi: PatientPHI, options: TokenizeOptions): string {
  return piiVault.tokenize(phi, options.callerContext, options.practiceId);
}

/**
 * Resolve a token back to PHI. MUST be called server-side, immediately before
 * dispatch (inside `initiateCall()`), and the result must never be logged,
 * persisted, or placed in Vapi `metadata` — ephemeral call `variables` only.
 */
export function detokenizePatientPHI(token: string, options: DetokenizeOptions): PatientPHI {
  const result = piiVault.detokenize(token, options.callerContext, {
    practiceId: options.practiceId,
    ipAddress: options.ipAddress,
  });
  if (!result.success || !result.phi) {
    throw new CallEngineTokenError(result.error ?? 'TOKEN_RESOLUTION_FAILED');
  }
  return result.phi;
}

/** Cheap liveness check — does not extend the token's TTL or touch the audit log. */
export function isPatientTokenValid(token: string): boolean {
  return piiVault.isValid(token);
}

/**
 * Revoke a token early, once a claim's call sequence reaches a terminal state
 * with no retry pending (Success, or Failed with attempts exhausted). Bounds
 * PHI exposure to the active window instead of the full TTL.
 */
export function revokePatientToken(token: string, callerContext: string): void {
  piiVault.expireToken(token, callerContext);
}
