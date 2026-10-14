/**
 * Breach register and custodian packet (privacy control W4).
 *
 * Implements the register fields named in policy-research (HP#2, HP#3, HP#4)
 * and the yearly per-category counts named in the W4 spec (O. Reg. 329/04 s.6.4,
 * citation to be confirmed by counsel). This module is pure: it validates
 * input, scans free text for direct identifiers, and builds the practice-facing
 * packet. It does not notify patients; the custodian does that.
 *
 * PENDING_COUNSEL: the category-to-count mapping and the retention floor
 * (BREACH_RETENTION_MONTHS) are engineering placeholders until counsel confirms.
 */

export const BREACH_CATEGORIES = [
  'DELETION_BREACH',
  'DATA_EXPOSURE',
  'UNAUTHORIZED_ACCESS',
  'SECURITY_INCIDENT',
  'POLICY_VIOLATION',
] as const;
export type BreachCategory = (typeof BREACH_CATEGORIES)[number];

/** PENDING_COUNSEL. Floor used by the retention job exemption (W7 reads this). */
export const BREACH_RETENTION_MONTHS = 24;

/** Required register fields, one per item in the spec's (a) to (g) list. */
export const REQUIRED_REGISTER_FIELDS = [
  'circumstances',
  'occurredFrom',
  'occurredTo',
  'dataElements',
  'numberOfIndividuals',
  'stepsToReduceHarm',
  'notificationSteps',
  'contactName',
] as const;
export type RequiredRegisterField = (typeof REQUIRED_REGISTER_FIELDS)[number];

export interface BreachRegisterInput {
  notificationType: string;
  discoveredAt: Date;
  circumstances?: string | null;
  occurredFrom?: Date | null;
  occurredTo?: Date | null;
  dataElements?: string[] | null;
  numberOfIndividuals?: number | null;
  stepsToReduceHarm?: string | null;
  notificationSteps?: string | null;
  contactName?: string | null;
  realRiskOfSignificantHarm?: boolean | null;
  custodianNotifiedAt?: Date | null;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; missing: RequiredRegisterField[]; reasons: string[] };

const DATA_ELEMENT_CODES = [
  'CONTACT',
  'HEALTH_RECORD',
  'INSURANCE_IDENTIFIER',
  'BILLING',
  'OTHER',
] as const;

const IDENTIFIER_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { name: 'phone', re: /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/ },
  { name: 'health-card-like', re: /\b\d{4}[\s-]?\d{3}[\s-]?\d{3}[A-Za-z]{0,2}\b/ },
  { name: 'sin-like', re: /\b\d{3}[\s-]\d{3}[\s-]\d{3}\b/ },
];

export function scanForIdentifiers(text: string): string[] {
  return IDENTIFIER_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
}

export function validateRegisterEntry(input: BreachRegisterInput): ValidationResult {
  const missing: RequiredRegisterField[] = [];
  const reasons: string[] = [];

  if (!BREACH_CATEGORIES.includes(input.notificationType as BreachCategory)) {
    reasons.push('notificationType is not one of the five register categories');
  }
  if (!input.circumstances?.trim()) missing.push('circumstances');
  if (!input.occurredFrom) missing.push('occurredFrom');
  if (!input.occurredTo) missing.push('occurredTo');
  if (!input.dataElements || input.dataElements.length === 0) missing.push('dataElements');
  if (input.numberOfIndividuals === null || input.numberOfIndividuals === undefined) {
    missing.push('numberOfIndividuals');
  }
  if (!input.stepsToReduceHarm?.trim()) missing.push('stepsToReduceHarm');
  if (!input.notificationSteps?.trim()) missing.push('notificationSteps');
  if (!input.contactName?.trim()) missing.push('contactName');

  if (input.occurredFrom && input.occurredTo && input.occurredFrom > input.occurredTo) {
    reasons.push('occurredFrom is after occurredTo');
  }
  if (input.occurredFrom && input.discoveredAt < input.occurredFrom) {
    reasons.push('discoveredAt is before occurredFrom');
  }
  if (input.numberOfIndividuals !== null && input.numberOfIndividuals !== undefined) {
    if (!Number.isInteger(input.numberOfIndividuals) || input.numberOfIndividuals < 0) {
      reasons.push('numberOfIndividuals must be a non-negative integer');
    }
  }
  for (const code of input.dataElements ?? []) {
    if (!(DATA_ELEMENT_CODES as readonly string[]).includes(code)) {
      reasons.push(`dataElements contains unknown code ${code}`);
    }
  }

  // Free text must not carry direct identifiers into the register or packet.
  for (const [field, value] of [
    ['circumstances', input.circumstances],
    ['stepsToReduceHarm', input.stepsToReduceHarm],
    ['notificationSteps', input.notificationSteps],
  ] as const) {
    if (value && scanForIdentifiers(value).length > 0) {
      reasons.push(`${field} appears to contain a direct identifier`);
    }
  }

  if (missing.length === 0 && reasons.length === 0) return { ok: true };
  return { ok: false, missing, reasons };
}

export interface BreachPacket {
  category: BreachCategory;
  discoveredAt: string;
  occurredFrom: string | null;
  occurredTo: string | null;
  dataElements: string[];
  numberOfIndividuals: number | null;
  circumstances: string;
  stepsToReduceHarm: string;
  notificationSteps: string;
  affectedPatientTokens: string[];
  vendorsInvolved: string[];
  custodianNotifiedAt: string | null;
}

/** Builds the practice-facing packet. Contains tokens and categories only. */
export function buildBreachPacket(
  input: BreachRegisterInput & { affectedPatientTokens?: string[]; vendorsInvolved?: string[] },
): BreachPacket {
  const check = validateRegisterEntry(input);
  if (!check.ok) {
    throw new Error(`breach register entry incomplete: ${[...check.missing, ...check.reasons].join('; ')}`);
  }
  return {
    category: input.notificationType as BreachCategory,
    discoveredAt: input.discoveredAt.toISOString(),
    occurredFrom: input.occurredFrom?.toISOString() ?? null,
    occurredTo: input.occurredTo?.toISOString() ?? null,
    dataElements: [...(input.dataElements ?? [])],
    numberOfIndividuals: input.numberOfIndividuals ?? null,
    circumstances: (input.circumstances ?? '').trim(),
    stepsToReduceHarm: (input.stepsToReduceHarm ?? '').trim(),
    notificationSteps: (input.notificationSteps ?? '').trim(),
    affectedPatientTokens: [...(input.affectedPatientTokens ?? [])],
    vendorsInvolved: [...(input.vendorsInvolved ?? [])],
    custodianNotifiedAt: input.custodianNotifiedAt?.toISOString() ?? null,
  };
}

/** Yearly counter for the five categories. Every category is present, even at zero. */
export function yearlyCategoryCounts(
  rows: Array<{ notificationType: string; discoveredAt: Date }>,
  year: number,
): Record<BreachCategory, number> {
  const out = Object.fromEntries(BREACH_CATEGORIES.map((c) => [c, 0])) as Record<BreachCategory, number>;
  for (const r of rows) {
    if (r.discoveredAt.getUTCFullYear() !== year) continue;
    if ((BREACH_CATEGORIES as readonly string[]).includes(r.notificationType)) {
      out[r.notificationType as BreachCategory] += 1;
    }
  }
  return out;
}
