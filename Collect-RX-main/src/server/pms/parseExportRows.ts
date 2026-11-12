/**
 * Flexible column resolver for PMS CSV/JSON exports.
 * Import family selects alias precedence; carrier phone logic does not branch on PMS.
 */

import type { PmsImportFamily } from '../../types/pms.js';

/**
 * Every spelling of a header the importer will look for. The CSV parser lowercases headers and turns spaces
 * into underscores before rows reach the importer, so a display name such as "Policy Number" must also be
 * looked up as policy_number. Without that, a column the screen calls required was silently never read.
 */
export function keyVariants(key: string): string[] {
  const snake = key.trim().toLowerCase().replace(/\s+/g, '_');
  return [...new Set([key, key.toLowerCase(), key.toUpperCase(), snake])];
}

export function getCell(raw: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    for (const variant of keyVariants(k)) {
      const val = raw[variant];
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        return String(val).trim();
      }
    }
  }
  return null;
}

export function parseMoney(raw: string | null | undefined): number {
  if (!raw) return 0;
  const n = parseFloat(String(raw).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Same parsing as parseMoney, but a cell that's present and non-blank yet not
 * a number throws instead of silently becoming 0. Used only for the two
 * fields (billed/outstanding) that decide whether a row is a real balance or
 * gets treated as already-paid-off: parseMoney's 0-fallback made a garbage
 * cell (e.g. a shifted-column export, "N/A", a formula error string)
 * indistinguishable from a genuine zero balance, so the row silently
 * disappeared into the "skipped" count with no error surfaced to the
 * importing user — reproduced live via /import with amount_billed="abc",
 * amount_outstanding="xyz" before this fix.
 */
export function parseMoneyStrict(raw: string | null, fieldLabel: string): number {
  if (!raw) return 0;
  const n = parseFloat(String(raw).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n)) {
    throw new Error(`${fieldLabel} "${raw}" is not a valid number`);
  }
  return n;
}

export function parseIntSafe(raw: string | null | undefined, fallback = 0): number {
  const n = parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

export interface NormalizedPmsClaimRow {
  claimNumber: string;
  patientFirstName: string;
  patientLastName: string;
  carrierName: string;
  procedureCode: string;
  servicedAt: Date | null;
  /// Date the claim was electronically submitted to the carrier (for agent use during calls).
  submittedAt: Date | null;
  /// CDT codes as a comma-separated string, e.g. "D1110,D0274" (for agent use during calls).
  treatmentCodes: string | null;
  billedAmount: number;
  outstandingAmount: number;
  /// What the practice expected the carrier to pay (distinct from outstandingAmount).
  expectedAmount: number | null;
  /// Insurance portion already paid per carrier remittance (when present in export).
  insurancePaidAmount: number | null;
  daysOutstanding: number;
  // ─── PHI fields — never stored in DB; passed to PIIVault only ────────────
  /// Patient date of birth — ISO YYYY-MM-DD. Stored in PIIVault only.
  patientDob: string | null;
  /// Member/certificate number on the plan card. Stored in PIIVault only.
  subscriberId: string | null;
  /// Employer group/plan number. Stored in PIIVault only.
  groupPolicyNumber: string | null;
  /// Name of the plan subscriber (when patient is a dependent). Stored in PIIVault only.
  subscriberName: string | null;
  /// DOB of the plan subscriber (required by some carriers when patient is a dependent).
  subscriberDateOfBirth: string | null;
  /** Relationship to subscriber — 'self' | 'spouse' | 'dependent' */
  relationship: string | null;
  /** AbelDent / CDAnet transaction type (e.g. T11 pre-auth denial) */
  transactionType: string | null;
  denialReasonCode: string | null;
  /**
   * Treating dentist's unique 9-digit CDA provider number, when the PMS
   * export includes one. Optional: most practices' exports predate this
   * column, so its absence does not fail the row — see
   * validateTreatingDentistForClaim, called only when this is present.
   */
  treatingDentistProviderNumber: string | null;
}


/**
 * The header spellings the importer reads for each field, in order. Shared with the aging-report
 * header check so what staff are told is required is exactly what the importer will look for.
 */
export const OUTSTANDING_KEYS = ['Amount Outstanding', 'Outstanding', 'Balance', 'amount_outstanding', 'Patient Balance', 'Ins Balance', 'Insurance Balance'];
export const DAYS_OUTSTANDING_KEYS = ['Days Outstanding', 'Days', 'days_outstanding', 'Aging Days', 'Age'];
export const SERVICE_DATE_KEYS = ['Date of Service', 'Service Date', 'treatment_date', 'Treatment Date', 'DOS', 'Proc Date'];
export const SUBMITTED_DATE_KEYS = ['Submission Date', 'Submitted Date', 'submitted_date', 'Claim Submitted', 'Date Submitted', 'submission_date', 'Submit Date'];
export const DOB_KEYS = ['Date of Birth', 'date_of_birth', 'DOB', 'dob', 'Patient DOB', 'patient_dob', 'Birth Date'];
export const FIRST_NAME_KEYS = ['Patient First Name', 'First Name', 'patient_first_name', 'FName', 'fname'];
export const LAST_NAME_KEYS = ['Patient Last Name', 'Last Name', 'patient_last_name', 'LName', 'lname'];
export const CARRIER_KEYS = [
  'Insurance Carrier',
  'Insurance Company',
  'Carrier',
  'Insurance',
  'carrier_name',
  'insurance_carrier',
  'Primary Insurance',
  'Ins Carrier',
  'Ins Company',
  'Plan Name',
];
export const SUBSCRIBER_ID_KEYS = [
  'Subscriber ID',
  'Subscriber Number',
  'Subscriber No',
  'SubscriberID',
  'Member ID',
  'Certificate Number',
  'Policy Number',
  'subscriber_id',
  'Member Number',
  'Certificate No',
  'Ins ID',
  'Insurance ID',
  'Policy No',
];

export const CLAIM_ID_KEYS: Record<PmsImportFamily, string[]> = {
  abeldent: ['Claim ID', 'ClaimID', 'Claim Number', 'claim_number', 'Ref', 'Reference', 'id'],
  dentrix: ['Claim ID', 'ClaimID', 'Claim Number', 'claim_number', 'Ref', 'Reference', 'id', 'Claim #'],
  generic: [
    'Claim ID',
    'ClaimID',
    'Claim Number',
    'claim_number',
    'Ref',
    'Reference',
    'id',
    'Claim #',
    'ClaimNum',
    'claim_num',
  ],
};

/** Claim identifier of a raw row, or null when the row has none. Lets callers name the claim of a row that fails normalization. */
export function claimIdOf(raw: Record<string, unknown>, importFamily: PmsImportFamily): string | null {
  return getCell(raw, ...CLAIM_ID_KEYS[importFamily]);
}

export function normalizePmsClaimRow(
  raw: Record<string, unknown>,
  importFamily: PmsImportFamily,
): NormalizedPmsClaimRow {
  const claimNumber = getCell(raw, ...CLAIM_ID_KEYS[importFamily]) ?? '';
  if (!claimNumber) {
    throw new Error(`Row missing claim identifier (${importFamily} export)`);
  }

  const outstanding = parseMoneyStrict(getCell(raw, ...OUTSTANDING_KEYS), 'Amount Outstanding');
  const billed =
    parseMoneyStrict(
      getCell(raw, 'Amount Billed', 'Billed', 'amount_billed', 'Total Billed', 'Fee', 'Submitted Amount'),
      'Amount Billed',
    ) || outstanding;

  const daysOutstanding = parseIntSafe(getCell(raw, ...DAYS_OUTSTANDING_KEYS));

  const serviceRaw = getCell(raw, ...SERVICE_DATE_KEYS);
  const servicedAt = serviceRaw ? new Date(serviceRaw) : null;

  const submittedRaw = getCell(raw, ...SUBMITTED_DATE_KEYS);
  const submittedAt = submittedRaw ? new Date(submittedRaw) : null;

  const dobRaw = getCell(raw, ...DOB_KEYS);
  // Normalize DOB to YYYY-MM-DD
  const patientDob = dobRaw
    ? (() => {
        const d = new Date(dobRaw);
        return !Number.isNaN(d.getTime()) ? d.toISOString().split('T')[0] : dobRaw;
      })()
    : null;

  const subDobRaw = getCell(
    raw,
    'Subscriber DOB',
    'Subscriber Date of Birth',
    'subscriber_date_of_birth',
    'subscriber_dob',
    'Policy Holder DOB',
    'policy_holder_dob',
    'Insured DOB',
  );
  const subscriberDateOfBirth = subDobRaw
    ? (() => {
        const d = new Date(subDobRaw);
        return !Number.isNaN(d.getTime()) ? d.toISOString().split('T')[0] : subDobRaw;
      })()
    : null;

  const expectedRaw = getCell(
    raw,
    'Expected Amount',
    'Insurance Expected',
    'expected_amount',
    'Ins Expected',
    'Expected Payment',
    'Estimated Insurance',
  );
  const expectedAmount = expectedRaw ? parseMoney(expectedRaw) : null;

  const paidRaw = getCell(
    raw,
    'Amount Paid',
    'Insurance Paid',
    'Ins Paid',
    'Paid Amount',
    'paid_amount',
    'Payment Received',
  );
  const insurancePaidAmount = paidRaw ? parseMoney(paidRaw) : null;

  const treatmentCodesRaw = getCell(
    raw,
    'Procedure Codes',
    'CDT Codes',
    'treatment_codes',
    'Procedures',
    'procedure_codes',
    'Codes',
  );

  return {
    claimNumber: claimNumber.trim(),
    patientFirstName: getCell(raw, ...FIRST_NAME_KEYS) ?? '',
    patientLastName: getCell(raw, ...LAST_NAME_KEYS) ?? '',
    carrierName: getCell(raw, ...CARRIER_KEYS) ?? '',
    procedureCode:
      getCell(raw, 'Procedure Code', 'Code', 'Proc Code', 'procedure_code', 'CDT', 'cdt_code') ?? '',
    servicedAt: servicedAt && !Number.isNaN(servicedAt.getTime()) ? servicedAt : null,
    submittedAt: submittedAt && !Number.isNaN(submittedAt.getTime()) ? submittedAt : null,
    treatmentCodes: treatmentCodesRaw ?? null,
    billedAmount: billed,
    outstandingAmount: outstanding,
    expectedAmount,
    insurancePaidAmount,
    daysOutstanding,
    // ─── PHI fields — not stored in DB, passed to PIIVault only ─────────────
    patientDob,
    subscriberId: getCell(raw, ...SUBSCRIBER_ID_KEYS),
    groupPolicyNumber: getCell(
      raw,
      'Group Number',
      'Plan Number',
      'group_number',
      'Group No',
      'Plan No',
      'Group ID',
      'group_policy_number',
    ),
    subscriberName: getCell(
      raw,
      'Subscriber Name',
      'Policy Holder',
      'subscriber_name',
      'Insured Name',
      'Policy Holder Name',
      'Guarantor Name',
    ),
    subscriberDateOfBirth,
    relationship: getCell(
      raw,
      'Relationship',
      'Relationship to Subscriber',
      'relationship',
      'Patient Relationship',
      'Rel to Insured',
    ),
    transactionType: getCell(
      raw,
      'Transaction Type',
      'Txn Type',
      'transaction_type',
      'Trans Type',
      'CDAnet Type',
    ),
    treatingDentistProviderNumber: getCell(
      raw,
      'Treating Dentist Provider Number',
      'Treating Dentist',
      'Provider Number',
      'CDA Provider Number',
      'treating_dentist_provider_number',
      'provider_number',
    ),
    denialReasonCode: getCell(
      raw,
      'Denial Code',
      'Denial Reason',
      'Reason Code',
      'denial_code',
      'denial_reason',
      'denial_reason_code',
      'EOB Code',
    ),
  };
}
