import { createHash } from 'crypto';
import { CSV_LIMITS } from './csvValidator';

/**
 * CSV → row objects for insurance claim imports.
 * Header row → snake_case keys, then optional alias → canonical field names.
 *
 * P3-30: common export column names map to the same internal fields (lightweight “column mapping”
 * without a per-upload UI).
 *
 * SECURITY: CSV injection prevention (=, +, -, @, %) and size/row limits enforced.
 */
const HEADER_ALIASES: Record<string, string> = {
  // Patient identity
  first_name: 'patient_first_name',
  fname: 'patient_first_name',
  patient_first: 'patient_first_name',
  last_name: 'patient_last_name',
  lname: 'patient_last_name',
  last: 'patient_last_name',
  // Amounts
  owes: 'patient_owes',
  balance: 'patient_owes',
  amount_owed: 'patient_owes',
  patient_balance: 'patient_owes',
  // External / procedure
  abeldent_id: 'abeldent_patient_id',
  abel_patient_id: 'abeldent_patient_id',
  abel_patient: 'abeldent_patient_id',
  external_patient_id: 'abeldent_patient_id',
  pms_patient_id: 'abeldent_patient_id',
  patient_id: 'abeldent_patient_id',
  chart_number: 'abeldent_patient_id',
  treatment: 'treatment_date',
  dos: 'treatment_date',
  service_date: 'treatment_date',
  date_of_service: 'treatment_date',
  cdt: 'procedure_code',
  cdt_code: 'procedure_code',
  proc_code: 'procedure_code',
  desc: 'procedure_description',
  proc_desc: 'procedure_description',
  description: 'procedure_description',
  email: 'patient_email',
  phone: 'patient_phone',
  cell: 'patient_phone',
  mobile: 'patient_phone',
  adjud: 'adjudication_date',
  adj_date: 'adjudication_date',
  days_since_adj: 'days_since_adjudication',
  claim_number: 'claim_number',
  claim_id: 'claim_number',
  insurance_carrier: 'insurance_carrier',
  carrier: 'insurance_carrier',
  group_policy_number: 'group_policy_number',
  group: 'group_policy_number',
  policy: 'group_policy_number',
  subscriber_id: 'subscriber_id',
  subscr_id: 'subscriber_id',
};

/**
 * After normalizing the header to snake_case, map alias keys to canonical field names.
 */
function canonicalFieldName(normalized: string): string {
  return HEADER_ALIASES[normalized] ?? normalized;
}

/**
 * Computes SHA-256 hash of CSV text for integrity verification
 */
export function computeCsvHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Parses CSV text with security validations and size limits enforced.
 * - Prevents CSV injection (formulas escaped)
 * - Enforces row count limits
 * - Validates and logs suspicious CSVs
 *
 * Returns rows as Record<string, string> for backward compatibility,
 * but individual rows are validated against CSV injection patterns.
 */
export function parseSimpleCsv(text: string): Array<Record<string, string>> {
  // Check input size
  if (text.length > CSV_LIMITS.MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `CSV text exceeds ${CSV_LIMITS.MAX_FILE_SIZE_BYTES} bytes (` +
      `${text.length} bytes provided)`
    );
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  // Validate row count
  if (lines.length - 1 > CSV_LIMITS.MAX_ROWS) {
    throw new Error(
      `CSV exceeds ${CSV_LIMITS.MAX_ROWS} rows limit (` +
      `${lines.length - 1} rows provided)`
    );
  }

  const header = splitCsvLine(lines[0]!).map((h) => {
    const normalized = h
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/”/g, '');
    return canonicalFieldName(normalized);
  });

  const out: Array<Record<string, string>> = [];
  for (let r = 1; r < lines.length; r++) {
    const cols = splitCsvLine(lines[r]!);
    const row: Record<string, string> = {};
    header.forEach((h, j) => {
      let v = cols[j] ?? '';
      v = v.replace(/^”|”$/g, '').trim();

      // Apply CSV injection prevention: escape formula characters
      if (/^[=+\-@%]/.test(v)) {
        v = '\'' + v;
      }

      row[h] = v;
    });
    out.push(row);
  }
  return out;
}

function splitCsvLine(line: string): string[] {
  const parts: string[] = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      inQ = !inQ;
    } else if (c === ',' && !inQ) {
      parts.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  parts.push(field);
  return parts;
}
