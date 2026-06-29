// ─────────────────────────────────────────────────────────────────────────────
// patientDataCompleteness.ts
//
// Pre-dispatch PHI completeness check.
//
// Carriers require at minimum: patient full name, date of birth, and the
// subscriber/member ID (certificate number). Without these the voice agent
// cannot authenticate the claim and the call will fail immediately.
//
// `groupPolicyNumber` is also almost universally required, but some carriers
// issue individual plans without a group number. We warn on it but do not
// block dispatch — the agent can attempt the call and the outcome will be
// FAILED or ESCALATED if the carrier actually requires it.
//
// Called in queueEngine between PHI resolution and initiateCall().
// ─────────────────────────────────────────────────────────────────────────────

import type { PatientPHI } from '../../pii-vault.js';

export interface PatientDataCompletenessResult {
  ok: boolean;
  /** Fields that are absent or blank — dispatch is blocked when this is non-empty. */
  missing: string[];
  /** Fields that are present but may cause call failure — dispatch continues. */
  warnings: string[];
}

// Fields that must be present and non-blank for any carrier call to succeed.
const REQUIRED: ReadonlyArray<keyof PatientPHI> = [
  'patientName',
  'dateOfBirth',
  'subscriberId',
];

// Fields that are usually required but some carriers accept without them.
const WARN_IF_ABSENT: ReadonlyArray<keyof PatientPHI> = [
  'groupPolicyNumber',
];

function isBlank(val: string | undefined): boolean {
  return !val || !val.trim();
}

/**
 * Validates that a detokenized PatientPHI record contains the fields necessary
 * to dispatch a carrier call. Returns `ok: false` with `missing` populated if
 * required fields are absent — the caller must skip dispatch in that case.
 *
 * Does NOT perform format validation (DOB ISO format, etc.) — that is handled
 * upstream in the CSV import validator. This is a nil/blank guard only.
 */
export function checkPatientDataCompleteness(
  phi: PatientPHI,
): PatientDataCompletenessResult {
  const missing: string[] = [];
  const warnings: string[] = [];

  for (const field of REQUIRED) {
    if (isBlank(phi[field] as string | undefined)) {
      missing.push(field);
    }
  }

  for (const field of WARN_IF_ABSENT) {
    if (isBlank(phi[field] as string | undefined)) {
      warnings.push(field);
    }
  }

  return { ok: missing.length === 0, missing, warnings };
}
