/**
 * Redacts PHI from call transcripts before they're persisted to
 * call_attempts.transcript_text. Agents speak the patient's name, DOB,
 * subscriber ID, and group number aloud to authenticate with carrier reps —
 * that speech reaches Vapi's transcript and, without this pass, went
 * straight into Postgres in plaintext, unredacted and outside both the audit
 * log and PII vault boundary.
 *
 * Two passes, neither alone sufficient:
 *   1. Known-value redaction — exact (case-insensitive) matches of the PHI
 *      actually used on this call, resolved from piiVault for this claim.
 *      Precise, but only catches values transcribed close to verbatim —
 *      speech-to-text renders a spoken DOB in many formats this won't match.
 *   2. Pattern redaction — the same PHI_PATTERNS webhookGuard.ts already uses
 *      to flag likely PHI (10-digit numbers, common date formats), as a
 *      defense-in-depth catch for anything pass 1 misses.
 *
 * Neither pass is a guarantee against every way PHI could appear in
 * freeform transcribed speech — this reduces exposure, it does not
 * eliminate it. Do not treat a redacted transcript as PHI-free without
 * spot-checking a sample.
 */
import type { PatientPHI } from '../../pii-vault.js';

const REDACTED = '[REDACTED]';

// Same patterns webhookGuard.ts scans for — kept in sync manually since the
// two modules serve different purposes (flag vs. rewrite) and diverging is
// safer than a shared import creating an accidental coupling between them.
const PHI_PATTERNS: RegExp[] = [
  /\b\d{10}\b/g, // 10-digit HCN
  /\b\d{4}-\d{2}-\d{2}\b/g, // DOB format YYYY-MM-DD
  /\b\d{2}\/\d{2}\/\d{4}\b/g, // DOB format MM/DD/YYYY
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replaces every case-insensitive literal occurrence of `value` with a placeholder. */
function redactLiteral(text: string, value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return text;
  const pattern = new RegExp(escapeRegExp(trimmed), 'gi');
  return text.replace(pattern, `${REDACTED}:${label}`);
}

/** Pass 1 — redact the exact PHI values known to have been used on this call. */
export function redactKnownPhi(text: string, phi: PatientPHI): string {
  let out = text;
  out = redactLiteral(out, phi.patientName, 'name');
  out = redactLiteral(out, phi.subscriberName, 'name');
  out = redactLiteral(out, phi.dateOfBirth, 'dob');
  out = redactLiteral(out, phi.subscriberDateOfBirth, 'dob');
  out = redactLiteral(out, phi.subscriberId, 'id');
  out = redactLiteral(out, phi.groupPolicyNumber, 'id');
  out = redactLiteral(out, phi.healthCardNumber, 'id');
  return out;
}

/** Pass 2 — redact anything matching a generic PHI-shaped pattern (defense-in-depth). */
export function redactPhiPatterns(text: string): string {
  let out = text;
  for (const pattern of PHI_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

export function redactTranscript(text: string, phi: PatientPHI | null): string {
  const knownRedacted = phi ? redactKnownPhi(text, phi) : text;
  return redactPhiPatterns(knownRedacted);
}
