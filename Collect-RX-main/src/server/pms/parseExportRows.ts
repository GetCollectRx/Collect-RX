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

export function parseMoney(raw: string | null | undefined): number {
  if (!raw) return 0;
  const n = parseFloat(String(raw).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
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
  billedAmount: number;
  outstandingAmount: number;
  daysOutstanding: number;
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
  );
  const billed = parseMoney(
    getCell(raw, 'Amount Billed', 'Billed', 'amount_billed', 'Total Billed', 'Fee', 'Submitted Amount'),
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

  return {
    claimNumber: claimNumber.trim(),
    patientFirstName:
      getCell(raw, 'Patient First Name', 'First Name', 'patient_first_name', 'FName', 'fname') ?? '',
    patientLastName:
      getCell(raw, 'Patient Last Name', 'Last Name', 'patient_last_name', 'LName', 'lname') ?? '',
    carrierName:
      getCell(
        raw,
        'Insurance Company',
        'Carrier',
        'Insurance',
        'carrier_name',
        'Primary Insurance',
        'Ins Carrier',
        'Plan Name',
      ) ?? '',
    procedureCode:
      getCell(raw, 'Procedure Code', 'Code', 'Proc Code', 'procedure_code', 'CDT', 'cdt_code') ?? '',
    servicedAt: servicedAt && !Number.isNaN(servicedAt.getTime()) ? servicedAt : null,
    billedAmount: billed,
    outstandingAmount: outstanding,
    daysOutstanding,
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
      'denial_reason_code',
      'EOB Code',
    ),
  };
}
