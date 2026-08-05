// ─────────────────────────────────────────────────────────────────────────────
// CollectRx AR Engine — Zero-Trust Local Tokenization
//
// PHIPA/PIPEDA BOUNDARY — read before touching this file:
//
//   The canonical PHI vault is `src/pii-vault.ts` (AES-256-GCM, practice-scoped,
//   encrypted DB persistence, access-audited). This module does NOT reimplement
//   tokenization crypto — a second vault would be a second place PHI can leak
//   from, which is exactly what a zero-trust boundary must not have.
//
//   Instead this file is the AR engine's narrow, typed front door onto that
//   vault (`tokenizePatient` / `detokenizePatient`), plus one thing the vault
//   does not provide: a runtime egress guard (`assertNoPhiInOutboundPayload`)
//   that inspects an object shape immediately before it crosses a trust
//   boundary (Vapi `metadata`, an external LLM call, a log line) and throws
//   if a PHI-shaped field is present and not explicitly allow-listed.
//
//   Compile-time typing (e.g. `VapiCallMetadata` having no PHI fields in
//   `src/vapi/client.ts`) is the primary control. This guard is defence in
//   depth for payloads assembled dynamically (spread, JSON round-trip,
//   `Record<string, unknown>`) where the type system alone cannot catch a
//   field that should never have been included.
//
//   Detokenization happens server-side only, immediately before dispatch
//   (see `src/vapi/client.ts` initiateCall PHI contract). Never call
//   `detokenizePatient` to log, persist, or forward PHI anywhere but the
//   ephemeral Vapi call `variables` payload.
// ─────────────────────────────────────────────────────────────────────────────

import { piiVault, type PatientPHI } from '../../pii-vault.js';

export type { PatientPHI } from '../../pii-vault.js';

export interface TokenizeContext {
  /** Tenant boundary — tokens are practice-scoped, never global. */
  practiceId: string;
  /** Free-text audit trail entry, e.g. "csv_import:row_42" or "abeldent_sync". */
  callerContext: string;
}

export interface DetokenizeContext extends TokenizeContext {
  ipAddress?: string;
}

export class PhiBoundaryViolationError extends Error {
  constructor(public readonly offendingKeys: readonly string[]) {
    super(
      `[tokenizer] Refusing to cross trust boundary — PHI-shaped field(s) present: ${offendingKeys.join(', ')}`,
    );
    this.name = 'PhiBoundaryViolationError';
  }
}

export class TokenNotFoundError extends Error {
  constructor(reason: string) {
    super(`[tokenizer] detokenizePatient failed: ${reason}`);
    this.name = 'TokenNotFoundError';
  }
}

/**
 * Issue a UUID token for structured patient PHI. Thin wrapper over the
 * canonical vault — see file header for why this does not own the crypto.
 */
export function tokenizePatient(phi: PatientPHI, ctx: TokenizeContext): string {
  return piiVault.tokenize(phi, ctx.callerContext, ctx.practiceId);
}

/**
 * Resolve a token back to PHI. Callers MUST be on the server-side dispatch
 * path only (see `src/vapi/client.ts` initiateCall) — never in a webhook
 * handler that logs or persists the result.
 */
export function detokenizePatient(token: string, ctx: DetokenizeContext): PatientPHI {
  const result = piiVault.detokenize(token, ctx.callerContext, {
    practiceId: ctx.practiceId,
    ipAddress: ctx.ipAddress,
  });
  if (!result.success || !result.phi) {
    throw new TokenNotFoundError(result.error ?? 'unknown vault error');
  }
  return result.phi;
}

/** UUID v4 shape check — cheap validation before a token round-trips to the vault. */
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidPatientToken(token: string): boolean {
  return UUID_V4_PATTERN.test(token);
}

// ---------------------------------------------------------------------------
// Egress guard — defence in depth at the trust boundary
// ---------------------------------------------------------------------------

/**
 * Object keys that indicate a PHI-shaped field. Matched case-insensitively
 * against a payload's own keys (not values) so this stays cheap enough to
 * run on every outbound call without shelling out to an NLP classifier.
 */
const PHI_KEY_SIGNALS: readonly RegExp[] = [
  /patient.?name/i,
  /^name$/i,
  /date.?of.?birth/i,
  /^dob$/i,
  /health.?card/i,
  /^hcn$/i,
  /\bsin\b/i,
  /social.?insurance/i,
  /subscriber.?name/i,
  /subscriber.?dob/i,
];

function isPhiShapedKey(key: string): boolean {
  return PHI_KEY_SIGNALS.some((p) => p.test(key));
}

/**
 * Scan a flat or nested payload for PHI-shaped keys and throw if any are
 * found outside `allowedKeys`. `allowedKeys` is the deliberate escape valve
 * for the one legitimate case — the ephemeral Vapi `variables` block built
 * in `initiateCall()` — so a caller must name exactly which PHI fields it
 * intends to send, rather than this guard silently passing everything.
 */
export function assertNoPhiInOutboundPayload(
  payload: Record<string, unknown>,
  allowedKeys: readonly string[] = [],
): void {
  const allowed = new Set(allowedKeys.map((k) => k.toLowerCase()));
  const offending: string[] = [];

  const visit = (obj: Record<string, unknown>, path: string): void => {
    for (const [key, value] of Object.entries(obj)) {
      const fullPath = path ? `${path}.${key}` : key;
      if (isPhiShapedKey(key) && !allowed.has(key.toLowerCase())) {
        offending.push(fullPath);
        continue;
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        visit(value as Record<string, unknown>, fullPath);
      }
    }
  };

  visit(payload, '');

  if (offending.length > 0) {
    throw new PhiBoundaryViolationError(offending);
  }
}

export const tokenizer = {
  tokenizePatient,
  detokenizePatient,
  isValidPatientToken,
  assertNoPhiInOutboundPayload,
} as const;

export default tokenizer;
