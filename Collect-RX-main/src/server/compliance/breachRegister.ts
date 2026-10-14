/**
 * Breach register and custodian packet (privacy control W4).
 *
 * Sources, read as raw page text on 2026-10-14 (not via a summarizing fetch):
 *   - SOR/2018-64 (Breach of Security Safeguards Regulations, justice-laws page,
 *     current to 2026-09-21): s.2(1)(a) to (g) required content of a breach
 *     report; s.6(1) breach record kept 24 months after the day the organization
 *     determines the breach has occurred.
 *   - O. Reg. 329/04 s.6.4(1), items 1 to 5 (ontario.ca page): annual report to
 *     the Commissioner by a health information custodian: stolen, lost, used
 *     without authority, disclosed without authority, collected through the EHR
 *     without authority.
 * Not verified: the PHIPA statute sections governing custodian notification
 * timing. No code here depends on them.
 *
 * This module is pure. It validates input, scans free text for direct
 * identifiers, builds the custodian packet, and counts annual categories.
 * It does not notify patients or the Commissioner; the custodian does that.
 */

/** O. Reg. 329/04 s.6.4(1) items 1 to 5. Each breach record carries the ones that apply. */
export const ANNUAL_REPORT_CATEGORIES = [
  'STOLEN',
  'LOST',
  'USED_WITHOUT_AUTHORITY',
  'DISCLOSED_WITHOUT_AUTHORITY',
  'EHR_COLLECTED_WITHOUT_AUTHORITY',
] as const;
export type AnnualReportCategory = (typeof ANNUAL_REPORT_CATEGORIES)[number];

/** Internal classification kept from the first slice. Not a statutory list. */
export const BREACH_CATEGORIES = [
  'DELETION_BREACH',
  'DATA_EXPOSURE',
  'UNAUTHORIZED_ACCESS',
  'SECURITY_INCIDENT',
  'POLICY_VIOLATION',
] as const;
export type BreachCategory = (typeof BREACH_CATEGORIES)[number];

/** SOR/2018-64 s.6(1): 24 months after the day the organization determines the breach occurred. */
export const BREACH_RETENTION_MONTHS = 24;

/** Required register fields, one per item in SOR/2018-64 s.2(1)(a) to (g). */
export const REQUIRED_REGISTER_FIELDS = [
  'circumstances',
  'occurredFrom',
  'occurredTo',
  'dataElements',
  'numberOfIndividuals',
  'stepsToReduceHarm',
  'notificationSteps',
  'contactName',
  'annualCategories',
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
  annualCategories?: string[] | null;
  realRiskOfSignificantHarm?: boolean | null;
  custodianNotifiedAt?: Date | null;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; missing: RequiredRegisterField[]; reasons: string[] };

const DATA_ELEMENT_CODES = ['CONTACT', 'HEALTH_RECORD', 'INSURANCE_IDENTIFIER', 'BILLING', 'OTHER'] as const;

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
    reasons.push('notificationType is not one of the register categories');
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
  if (!input.annualCategories || input.annualCategories.length === 0) missing.push('annualCategories');

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
  for (const code of input.annualCategories ?? []) {
    if (!(ANNUAL_REPORT_CATEGORIES as readonly string[]).includes(code)) {
      reasons.push(`annualCategories contains unknown code ${code}`);
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
  annualCategories: AnnualReportCategory[];
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

/** Builds the practice-facing packet. Contains tokens and codes only. */
export function buildBreachPacket(
  input: BreachRegisterInput & { affectedPatientTokens?: string[]; vendorsInvolved?: string[] },
): BreachPacket {
  const check = validateRegisterEntry(input);
  if (!check.ok) {
    throw new Error(`breach register entry incomplete: ${[...check.missing, ...check.reasons].join('; ')}`);
  }
  return {
    category: input.notificationType as BreachCategory,
    annualCategories: [...(input.annualCategories ?? [])] as AnnualReportCategory[],
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

/**
 * O. Reg. 329/04 s.6.4(1) annual counts for one calendar year (UTC). A record
 * contributes one count to each annual category it carries. Every category is
 * present, zero-filled.
 */
export function yearlyAnnualCounts(
  rows: Array<{ annualCategories: string[]; discoveredAt: Date }>,
  year: number,
): Record<AnnualReportCategory, number> {
  const out = Object.fromEntries(ANNUAL_REPORT_CATEGORIES.map((c) => [c, 0])) as Record<AnnualReportCategory, number>;
  for (const r of rows) {
    if (r.discoveredAt.getUTCFullYear() !== year) continue;
    for (const c of r.annualCategories) {
      if ((ANNUAL_REPORT_CATEGORIES as readonly string[]).includes(c)) {
        out[c as AnnualReportCategory] += 1;
      }
    }
  }
  return out;
}
