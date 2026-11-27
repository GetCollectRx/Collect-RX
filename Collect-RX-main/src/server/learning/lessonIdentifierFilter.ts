/**
 * Rejects carrier lessons that repeat the patient's own identifiers.
 *
 * Lessons are stored in a table shared across practices, so a name or date of
 * birth that reaches it is cross-tenant PHI at rest. The shape filter in
 * carrierLessons.ts cannot see names, so this check matches the exact values
 * used on the call, resolved from the PHI vault for that claim.
 *
 * Matching is deliberately broad: a lesson that is wrongly dropped costs one
 * learning opportunity, while a leaked identifier is a privacy breach.
 */
import type { PatientPHI } from '../../pii-vault.js';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MIN_NAME_TOKEN_LENGTH = 2;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Written forms of an ISO YYYY-MM-DD date as a speaker or model might render it. */
function dateVariants(iso: string | undefined): string[] {
  const trimmed = iso?.trim();
  const match = trimmed?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!trimmed || !match) return [];
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return [];
  }
  const monthName = MONTH_NAMES[month - 1];
  const dd = String(day).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  return [
    trimmed,
    `${year}/${mm}/${dd}`,
    `${mm}/${dd}/${year}`,
    `${dd}/${mm}/${year}`,
    `${monthName} ${day}, ${year}`,
    `${monthName} ${day} ${year}`,
    `${day} ${monthName} ${year}`,
  ];
}

function nameTokens(name: string | undefined): string[] {
  if (!name) return [];
  return name
    .split(/[\s\-']+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= MIN_NAME_TOKEN_LENGTH);
}

/** Every identifier value that must not appear in a lesson for this call. */
export function knownIdentifierValues(phi: PatientPHI): string[] {
  const values = [
    phi.patientName,
    phi.subscriberName,
    phi.subscriberId,
    phi.groupPolicyNumber,
    phi.healthCardNumber,
    ...dateVariants(phi.dateOfBirth),
    ...dateVariants(phi.subscriberDateOfBirth),
    ...nameTokens(phi.patientName),
    ...nameTokens(phi.subscriberName),
  ];
  const trimmed = values.map((v) => v?.trim() ?? '').filter((v) => v.length > 0);
  return [...new Set(trimmed)];
}

/** True when the lesson text contains any identifier value used on this call. */
export function leaksKnownIdentifier(text: string, phi: PatientPHI): boolean {
  return knownIdentifierValues(phi).some((value) => {
    const pattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(value)}(?![A-Za-z0-9])`, 'i');
    return pattern.test(text);
  });
}
