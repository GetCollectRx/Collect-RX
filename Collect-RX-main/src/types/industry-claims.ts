/**
 * Multi-vertical claim model (Phase 1).
 *
 * These literals mirror the Prisma enums `IndustryType` and `ReferenceKind`
 * (prisma/schema.prisma). They are declared here, not imported from
 * @prisma/client, so config and parser code stays usable before `prisma generate`
 * has run. tests/industry-claims.test.ts asserts the two stay identical.
 *
 * PHI RULE: person-linked identifiers (patient id, MRN, VIN, policy number) and
 * insured names exist in memory only during import. They are tokenized through
 * PIIVault before anything is persisted. See pii-vault.ts and the CHECK
 * constraints in migration 20261017120100_industry_type_polymorphic_claims.
 */

export const INDUSTRY_TYPES = [
  'DENTAL',
  'AUTO_COLLISION',
  'PROPERTY_RESTORATION',
  'PARAMEDICAL_PHYSIO',
  'DME',
  'ROOFING_TRADES',
  'NEMT',
] as const;
export type IndustryType = (typeof INDUSTRY_TYPES)[number];

export const REFERENCE_KINDS = [
  'PATIENT_ID',
  'MRN',
  'VIN',
  'POLICY_NUMBER',
  'REPAIR_ORDER',
  'JOB_NUMBER',
  'TRIP_ID',
  'SALES_ORDER',
  'CASE_NUMBER',
] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

/** Kinds that identify a person or their property; stored as PIIVault tokens only. */
export const PERSONAL_REFERENCE_KINDS: ReadonlySet<ReferenceKind> = new Set<ReferenceKind>([
  'PATIENT_ID',
  'MRN',
  'VIN',
  'POLICY_NUMBER',
]);

export function isPersonalReferenceKind(kind: ReferenceKind): boolean {
  return PERSONAL_REFERENCE_KINDS.has(kind);
}

/** Which identifiers each vertical uses for primary / secondary reference. */
export const INDUSTRY_REFERENCE_KINDS: Record<
  IndustryType,
  { primary: ReferenceKind; secondary?: ReferenceKind }
> = {
  DENTAL: { primary: 'PATIENT_ID' },
  AUTO_COLLISION: { primary: 'REPAIR_ORDER', secondary: 'VIN' },
  PROPERTY_RESTORATION: { primary: 'JOB_NUMBER', secondary: 'POLICY_NUMBER' },
  PARAMEDICAL_PHYSIO: { primary: 'PATIENT_ID' },
  DME: { primary: 'SALES_ORDER' },
  ROOFING_TRADES: { primary: 'JOB_NUMBER', secondary: 'POLICY_NUMBER' },
  NEMT: { primary: 'TRIP_ID' },
};

export interface ClaimLineItem {
  /** CDT/CPT/Xactimate/Symbility/CCC/Mitchell/Audatex line code, as exported. */
  code: string;
  description: string;
  /** Decimal string with 2 places, for example "1234.50". Never a float. */
  amount: string;
}

/**
 * One normalized CSV row. Holds RAW identifiers in memory during import only.
 * Convert with toClaimPersistFields() before writing to the database.
 */
export interface CanonicalClaimRecord {
  industryType: IndustryType;
  /** Payer's claim number. Maps to InsuranceClaim.claimNumber. */
  claimNumber: string;
  primaryReferenceId: string;
  primaryReferenceKind: ReferenceKind;
  secondaryReferenceId?: string;
  secondaryReferenceKind?: ReferenceKind;
  payerName: string;
  /** NANP number in E.164 form (+1XXXXXXXXXX), when the export carried one. */
  payerPhone?: string;
  /** In memory only. Hand to PIIVault; never persisted on the claim row. */
  insuredName: string;
  /** ISO 8601 date (YYYY-MM-DD). */
  dateOfService: string;
  /** Decimal strings, 2 places. */
  billedAmount: string;
  balanceDue: string;
  agingDays?: number;
  lineItems?: ClaimLineItem[];
  /** SHA-256 of claimNumber|dateOfService|billedAmount for idempotent re-uploads. */
  rowHash: string;
  /** 1-based row number in the source file (header = row 1). */
  sourceRow: number;
}

/** Columns written to insurance_claims for the polymorphic fields. */
export interface ClaimPersistFields {
  industryType: IndustryType;
  primaryReferenceId: string;
  primaryReferenceKind: ReferenceKind;
  secondaryReferenceId: string | null;
  secondaryReferenceKind: ReferenceKind | null;
  payerName: string;
  lineItems: ClaimLineItem[] | null;
}
