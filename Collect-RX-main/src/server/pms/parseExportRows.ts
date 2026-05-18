/**
 * Flexible column resolver for Dentrix / AbelDent CSV exports.
 */

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
}

export function normalizePmsClaimRow(
  raw: Record<string, unknown>,
  pmsSource: 'dentrix' | 'abeldent',
): NormalizedPmsClaimRow {
  const claimNumber =
    getCell(raw, 'Claim ID', 'ClaimID', 'Claim Number', 'claim_number', 'Ref', 'Reference', 'id') ??
    '';
  if (!claimNumber) {
    throw new Error(`Row missing claim identifier (${pmsSource})`);
  }

  const outstanding = parseMoney(
    getCell(raw, 'Amount Outstanding', 'Outstanding', 'Balance', 'amount_outstanding', 'Patient Balance'),
  );
  const billed = parseMoney(
    getCell(raw, 'Amount Billed', 'Billed', 'amount_billed', 'Total Billed'),
  ) || outstanding;

  const daysOutstanding = parseIntSafe(
    getCell(raw, 'Days Outstanding', 'Days', 'days_outstanding', 'Aging Days'),
  );

  const serviceRaw = getCell(
    raw,
    'Date of Service',
    'Service Date',
    'treatment_date',
    'Treatment Date',
    'DOS',
  );
  const servicedAt = serviceRaw ? new Date(serviceRaw) : null;

  return {
    claimNumber: claimNumber.trim(),
    patientFirstName: getCell(raw, 'Patient First Name', 'First Name', 'patient_first_name') ?? '',
    patientLastName: getCell(raw, 'Patient Last Name', 'Last Name', 'patient_last_name') ?? '',
    carrierName: getCell(raw, 'Insurance Company', 'Carrier', 'Insurance', 'carrier_name', 'Primary Insurance') ?? '',
    procedureCode: getCell(raw, 'Procedure Code', 'Code', 'Proc Code', 'procedure_code') ?? '',
    servicedAt: servicedAt && !Number.isNaN(servicedAt.getTime()) ? servicedAt : null,
    billedAmount: billed,
    outstandingAmount: outstanding,
    daysOutstanding,
  };
}
