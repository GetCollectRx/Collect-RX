/**
 * Flexible column resolver for PMS CSV/JSON exports.
 * Import family selects alias precedence; carrier phone logic does not branch on PMS.
 */

import type { PmsImportFamily } from '../../types/pms.js';

export function getCell(raw: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const val = raw[k] ?? raw[k.toLowerCase()] ?? raw[k.toUpperCase()];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      return String(val).trim();
    }
  }
  return null;
}

export function parseMoney(raw: string | null | undefined, fieldName?: string): number {
  if (!raw) return 0;
  const str = String(raw).trim();
  if (!str) return 0;
  const n = parseFloat(str.replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n)) {
    throw new Error(`${fieldName || 'Amount'} "${raw}" is not a valid number`);
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
}

const CLAIM_ID_KEYS: Record<PmsImportFamily, string[]> = {
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

export function normalizePmsClaimRow(
  raw: Record<string, unknown>,
  importFamily: PmsImportFamily,
): NormalizedPmsClaimRow {
  const claimNumber = getCell(raw, ...CLAIM_ID_KEYS[importFamily]) ?? '';
  if (!claimNumber) {
    throw new Error(`Row missing claim identifier (${importFamily} export)`);
  }

  const outstanding = parseMoney(
    getCell(
      raw,
      'Amount Outstanding',
      'Outstanding',
      'Balance',
      'amount_outstanding',
      'Patient Balance',
      'Ins Balance',
      'Insurance Balance',
    ),
    'Amount Outstanding',
  );
  const billed = parseMoney(
    getCell(raw, 'Amount Billed', 'Billed', 'amount_billed', 'Total Billed', 'Fee', 'Submitted Amount'),
    'Amount Billed',
  ) || outstanding;

  const daysOutstanding = parseIntSafe(
    getCell(raw, 'Days Outstanding', 'Days', 'days_outstanding', 'Aging Days', 'Age'),
  );

  const serviceRaw = getCell(
    raw,
    'Date of Service',
    'Service Date',
    'treatment_date',
    'Treatment Date',
    'DOS',
    'Proc Date',
  );
  const servicedAt = serviceRaw ? new Date(serviceRaw) : null;

  const submittedRaw = getCell(
    raw,
    'Submission Date',
    'Submitted Date',
    'submitted_date',
    'Claim Submitted',
    'Date Submitted',
    'submission_date',
    'Submit Date',
  );
  const submittedAt = submittedRaw ? new Date(submittedRaw) : null;

  const dobRaw = getCell(
    raw,
    'Date of Birth',
    'DOB',
    'dob',
    'Patient DOB',
    'patient_dob',
    'Birth Date',
  );
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
  const expectedAmount = expectedRaw ? parseMoney(expectedRaw, 'Expected Amount') : null;

  const paidRaw = getCell(
    raw,
    'Amount Paid',
    'Insurance Paid',
    'Ins Paid',
    'Paid Amount',
    'paid_amount',
    'Payment Received',
  );
  const insurancePaidAmount = paidRaw ? parseMoney(paidRaw, 'Insurance Paid Amount') : null;

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
    patientFirstName:
      getCell(raw, 'Patient First Name', 'First Name', 'patient_first_name', 'FName', 'fname') ?? '',
    patientLastName:
      getCell(raw, 'Patient Last Name', 'Last Name', 'patient_last_name', 'LName', 'lname') ?? '',
    carrierName:
      getCell(
        raw,
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
      ) ?? '',
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
    subscriberId: getCell(
      raw,
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
    ),
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
