/**
 * Industry-aware CSV normalizer.
 *
 * Turns an uploaded A/R export into CanonicalClaimRecord objects for the
 * tenant's selected IndustryType, using the alias dictionary in
 * src/config/csv-aliases.ts. Pure and synchronous: no database, no network.
 *
 * Scope: this is the path for the multi-vertical expansion. The existing dental
 * import (parseSimpleCsv) is untouched.
 *
 * Safety properties:
 *  - Limits from CSV_LIMITS (size, rows) are enforced before parsing.
 *  - Required columns missing => the whole file is rejected, never guessed.
 *  - Slashed dates default to month-first (MM/DD/YYYY). When a file contains a
 *    date that can only be day-first (for example 25/04/2026) and the caller did
 *    not supply dateFormat, the file is rejected with DATE_FORMAT_REQUIRED
 *    instead of mixing interpretations. Ambiguous dates read under the default
 *    are reported as DATE_ASSUMED_MDY warnings. An explicit dateFormat is strict.
 *  - Money is handled as integer cents and emitted as 2-place decimal strings.
 *  - Free-text fields are neutralised against spreadsheet formula injection.
 *  - Raw identifiers stay in memory. toClaimPersistFields() requires a
 *    tokenizer so person-linked identifiers never reach the database raw.
 */

import { createHash } from 'crypto';
import { buildAliasLookup, normalizeHeader, REQUIRED_FIELDS, type CanonicalField } from '../../config/csv-aliases';
import {
  INDUSTRY_REFERENCE_KINDS,
  INDUSTRY_TYPES,
  isPersonalReferenceKind,
  type CanonicalClaimRecord,
  type ClaimLineItem,
  type ClaimPersistFields,
  type IndustryType,
  type ReferenceKind,
} from '../../types/industry-claims';
import { CSV_LIMITS } from './csvValidator';

export type DateFormat = 'YMD' | 'DMY' | 'MDY';

export interface ParseIndustryCsvOptions {
  industryType: IndustryType;
  /** Explicit slashed-date order from the upload config. Omit to use the month-first default. */
  dateFormat?: DateFormat;
  /** Max characters allowed in identifier and name fields. Default 500. */
  maxFieldLength?: number;
}

export interface RowIssue {
  row: number;
  field?: CanonicalField;
  code: string;
  message: string;
}

export interface ParseIndustryCsvResult {
  industryType: IndustryType;
  records: CanonicalClaimRecord[];
  /** Rows that failed validation. They belong in the corrupt-claims review queue. */
  rejected: RowIssue[];
  warnings: RowIssue[];
  /** Rows whose ambiguous slashed date was read month-first under the default. */
  dateAssumedRowCount: number;
  /** Duplicate rows inside this file (same rowHash); the first occurrence is kept. */
  duplicateRows: number[];
  mappedHeaders: Partial<Record<CanonicalField, string>>;
  unmappedHeaders: string[];
  totalRows: number;
}

export class CsvStructureError extends Error {
  constructor(
    message: string,
    readonly code: 'EMPTY' | 'TOO_LARGE' | 'TOO_MANY_ROWS' | 'MISSING_REQUIRED_COLUMNS' | 'DATE_FORMAT_REQUIRED' | 'BAD_INDUSTRY' | 'TOO_MANY_ERRORS',
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'CsvStructureError';
  }
}

const DEFAULT_MAX_FIELD_LENGTH = 500;

// ── RFC 4180 tokenizer ───────────────────────────────────────────────────────

function tokenizeCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows;
}

// ── Field parsers ────────────────────────────────────────────────────────────

/** Neutralise leading formula characters in free text. */
export function neutraliseFormula(value: string): string {
  return /^[=+\-@%\t\r]/.test(value) ? `'${value}` : value;
}

/**
 * NANP phone to E.164. Accepts 10 digits or 1 + 10 digits; area code and
 * exchange must start 2-9. Returns null for anything else.
 * (Replaces the blueprint's `^\+12-9\d{9}$`, which is not a valid NANP pattern.)
 */
export function parseNanpPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(ten)) return null;
  return `+1${ten}`;
}

/** Money to integer cents. Handles $, CAD, thousands separators, (negatives), and French "1 234,50 $". */
export function parseMoneyToCents(raw: string): number | null {
  let s = raw.replace(/[\u00A0\u202F]/g, ' ').trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/\b(CAD|USD|CA|US)\b/gi, '').replace(/[$€£\s]/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  // Decide decimal separator: the last of , or . with 1-2 digits after it.
  const m = /^(\d[\d.,]*?)(?:[.,](\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const whole = m[1]!.replace(/[.,]/g, '');
  const frac = (m[2] ?? '').padEnd(2, '0');
  if (!/^\d+$/.test(whole)) return null;
  const cents = Number(whole) * 100 + Number(frac);
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

export function centsToDecimalString(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

function validYmd(y: number, m: number, d: number): boolean {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= dim;
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * Returns an ISO date, or an error code.
 *  - ISO (YYYY-MM-DD, YYYY/MM/DD) is always unambiguous.
 *  - Slashed or dashed A/B/YYYY follows `format` strictly when given.
 *  - With no format: month-first by default; a first part above 12 can only be
 *    day-first, so it returns DMY_EVIDENCE_NO_FORMAT for the caller to reject the file.
 */
export function parseDate(
  raw: string,
  format?: DateFormat,
): { ok: true; value: string; assumed: boolean } | { ok: false; code: string } {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validYmd(y, mo, d) ? { ok: true, value: iso(y, mo, d), assumed: false } : { ok: false, code: 'INVALID_DATE' };
  }
  m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validYmd(y, mo, d) ? { ok: true, value: iso(y, mo, d), assumed: false } : { ok: false, code: 'INVALID_DATE' };
  }
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (!m) return { ok: false, code: 'UNRECOGNISED_DATE' };
  const a = Number(m[1]);
  const b = Number(m[2]);
  const y = Number(m[3]);
  let month: number;
  let day: number;
  let assumed = false;
  if (format === 'MDY') {
    month = a;
    day = b;
  } else if (format === 'DMY') {
    day = a;
    month = b;
  } else if (format === 'YMD') {
    return { ok: false, code: 'UNRECOGNISED_DATE' };
  } else if (a > 12) {
    return { ok: false, code: 'DMY_EVIDENCE_NO_FORMAT' };
  } else {
    month = a;
    day = b;
    assumed = a !== b && b <= 12;
  }
  return validYmd(y, month, day) ? { ok: true, value: iso(y, month, day), assumed } : { ok: false, code: 'INVALID_DATE' };
}

// ── Main entry ───────────────────────────────────────────────────────────────

export function parseIndustryCsv(text: string, options: ParseIndustryCsvOptions): ParseIndustryCsvResult {
  const { industryType, dateFormat } = options;
  const maxLen = options.maxFieldLength ?? DEFAULT_MAX_FIELD_LENGTH;

  if (!(INDUSTRY_TYPES as readonly string[]).includes(industryType)) {
    throw new CsvStructureError(`Unsupported industry type: ${String(industryType)}`, 'BAD_INDUSTRY');
  }
  if (text.length > CSV_LIMITS.MAX_FILE_SIZE_BYTES) {
    throw new CsvStructureError('CSV exceeds the maximum file size', 'TOO_LARGE');
  }

  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const table = tokenizeCsv(body);
  if (table.length < 2) throw new CsvStructureError('CSV has no data rows', 'EMPTY');
  if (table.length - 1 > CSV_LIMITS.MAX_ROWS) {
    throw new CsvStructureError(`CSV exceeds ${CSV_LIMITS.MAX_ROWS} rows`, 'TOO_MANY_ROWS');
  }

  // Header resolution
  const lookup = buildAliasLookup(industryType);
  const headerRow = table[0]!.map((h) => h.trim());
  const colFor: Partial<Record<CanonicalField, number>> = {};
  const mappedHeaders: Partial<Record<CanonicalField, string>> = {};
  const unmappedHeaders: string[] = [];
  headerRow.forEach((h, idx) => {
    const field = lookup.get(normalizeHeader(h));
    if (field && colFor[field] === undefined) {
      colFor[field] = idx;
      mappedHeaders[field] = h;
    } else {
      unmappedHeaders.push(h);
    }
  });

  const missing = REQUIRED_FIELDS[industryType].filter((f) => colFor[f] === undefined);
  if (missing.length > 0) {
    throw new CsvStructureError(
      `Missing required columns for ${industryType}: ${missing.join(', ')}`,
      'MISSING_REQUIRED_COLUMNS',
      { missing, unmappedHeaders },
    );
  }

  const kinds = INDUSTRY_REFERENCE_KINDS[industryType];
  const records: CanonicalClaimRecord[] = [];
  const rejected: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  const duplicateRows: number[] = [];
  const seen = new Set<string>();
  let dateAssumedRowCount = 0;

  for (let r = 1; r < table.length; r++) {
    const cells = table[r]!;
    const rowNo = r + 1;
    const get = (f: CanonicalField): string => {
      const idx = colFor[f];
      return idx === undefined ? '' : (cells[idx] ?? '').trim();
    };
    const fail = (field: CanonicalField | undefined, code: string, message: string) => {
      rejected.push({ row: rowNo, field, code, message });
    };

    const claimNumber = get('claimNumber');
    const primary = get('primaryReferenceId');
    const payerName = get('payerName');
    const insuredName = get('insuredName');
    let bad = false;
    for (const [f, v] of [
      ['claimNumber', claimNumber],
      ['primaryReferenceId', primary],
      ['payerName', payerName],
      ['insuredName', insuredName],
    ] as Array<[CanonicalField, string]>) {
      if (!v) {
        fail(f, 'REQUIRED_VALUE_MISSING', `${f} is empty`);
        bad = true;
      } else if (v.length > maxLen) {
        fail(f, 'VALUE_TOO_LONG', `${f} exceeds ${maxLen} characters`);
        bad = true;
      }
    }

    const dos = parseDate(get('dateOfService'), dateFormat);
    if (!dos.ok && dos.code === 'DMY_EVIDENCE_NO_FORMAT') {
      throw new CsvStructureError(
        `Row ${rowNo} has a day-first date ("${get('dateOfService')}") but no dateFormat was set. Set dateFormat to DMY or MDY in the upload config.`,
        'DATE_FORMAT_REQUIRED',
        { row: rowNo },
      );
    }
    if (!dos.ok) {
      fail('dateOfService', dos.code, `dateOfService "${get('dateOfService')}" could not be read`);
      bad = true;
    }

    const balanceCents = parseMoneyToCents(get('balanceDue'));
    if (balanceCents === null) {
      fail('balanceDue', 'INVALID_AMOUNT', `balanceDue "${get('balanceDue')}" is not a valid amount`);
      bad = true;
    }
    let billedCents: number | null = null;
    const billedRaw = get('billedAmount');
    if (billedRaw) {
      billedCents = parseMoneyToCents(billedRaw);
      if (billedCents === null) {
        fail('billedAmount', 'INVALID_AMOUNT', `billedAmount "${billedRaw}" is not a valid amount`);
        bad = true;
      }
    }

    let payerPhone: string | undefined;
    const phoneRaw = get('payerPhone');
    if (phoneRaw) {
      const p = parseNanpPhone(phoneRaw);
      if (p) payerPhone = p;
      else warnings.push({ row: rowNo, field: 'payerPhone', code: 'INVALID_PHONE', message: 'Payer phone ignored: not a valid North American number' });
    }

    let agingDays: number | undefined;
    const agingRaw = get('agingDays');
    if (agingRaw) {
      const n = Number(agingRaw.replace(/[^\d]/g, ''));
      if (Number.isInteger(n) && n >= 0 && n < 20000) agingDays = n;
      else warnings.push({ row: rowNo, field: 'agingDays', code: 'INVALID_AGING', message: 'Aging days ignored' });
    }

    if (bad || !dos.ok || balanceCents === null) continue;
    if (dos.assumed) {
      dateAssumedRowCount++;
      if (dateAssumedRowCount <= 50) {
        warnings.push({ row: rowNo, field: 'dateOfService', code: 'DATE_ASSUMED_MDY', message: `Ambiguous date "${get('dateOfService')}" read as month-first; set dateFormat to confirm` });
      }
    }

    if (billedCents === null) {
      billedCents = balanceCents;
      warnings.push({ row: rowNo, field: 'billedAmount', code: 'BILLED_DEFAULTED_TO_BALANCE', message: 'No billed amount column; balance used as billed amount' });
    }

    const lineCode = get('lineItemCode');
    const lineDesc = get('lineItemDescription');
    let lineItems: ClaimLineItem[] | undefined;
    if (lineCode || lineDesc) {
      lineItems = [{ code: neutraliseFormula(lineCode), description: neutraliseFormula(lineDesc), amount: centsToDecimalString(billedCents) }];
    }

    const secondary = get('secondaryReferenceId');
    const billed = centsToDecimalString(billedCents);
    const rowHash = createHash('sha256').update(`${claimNumber}|${dos.value}|${billed}`).digest('hex');
    if (seen.has(rowHash)) {
      duplicateRows.push(rowNo);
      continue;
    }
    seen.add(rowHash);

    records.push({
      industryType,
      claimNumber: neutraliseFormula(claimNumber),
      primaryReferenceId: primary,
      primaryReferenceKind: kinds.primary,
      ...(secondary && kinds.secondary
        ? { secondaryReferenceId: secondary, secondaryReferenceKind: kinds.secondary }
        : {}),
      payerName: neutraliseFormula(payerName),
      ...(payerPhone ? { payerPhone } : {}),
      insuredName: neutraliseFormula(insuredName),
      dateOfService: dos.value,
      billedAmount: billed,
      balanceDue: centsToDecimalString(balanceCents),
      ...(agingDays !== undefined ? { agingDays } : {}),
      ...(lineItems ? { lineItems } : {}),
      rowHash,
      sourceRow: rowNo,
    });
  }

  const total = table.length - 1;
  const rowsWithIssues = new Set(rejected.map((i) => i.row)).size;
  if (total > 0 && rowsWithIssues / total > CSV_LIMITS.MAX_ERROR_RATE) {
    throw new CsvStructureError(
      `Too many invalid rows (${rowsWithIssues} of ${total}); file quarantined for review`,
      'TOO_MANY_ERRORS',
      { rejected: rejected.slice(0, CSV_LIMITS.MAX_ERRORS_TO_STORE), mappedHeaders, unmappedHeaders },
    );
  }

  return { industryType, records, rejected, warnings, dateAssumedRowCount, duplicateRows, mappedHeaders, unmappedHeaders, totalRows: total };
}

/**
 * Build the polymorphic columns for insurance_claims. Person-linked identifiers
 * (patient id, MRN, VIN, policy number) pass through `tokenize`, which must
 * return a PIIVault UUID token. Business-document identifiers (RO #, Job #,
 * Trip ID, Sales Order #, Case #) are stored as exported.
 *
 * The caller still owns: tokenizing insuredName into the claim's patientToken,
 * and setting carrierId ('other' for non-dental) and practiceId.
 */
export function toClaimPersistFields(
  record: CanonicalClaimRecord,
  tokenize: (kind: ReferenceKind, rawValue: string) => string,
): ClaimPersistFields {
  const guard = (kind: ReferenceKind, raw: string): string => {
    if (!isPersonalReferenceKind(kind)) return raw;
    const token = tokenize(kind, raw);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token) || token === raw) {
      throw new Error(`Tokenizer did not return a vault token for ${kind}`);
    }
    return token;
  };
  return {
    industryType: record.industryType,
    primaryReferenceId: guard(record.primaryReferenceKind, record.primaryReferenceId),
    primaryReferenceKind: record.primaryReferenceKind,
    secondaryReferenceId:
      record.secondaryReferenceId && record.secondaryReferenceKind
        ? guard(record.secondaryReferenceKind, record.secondaryReferenceId)
        : null,
    secondaryReferenceKind: record.secondaryReferenceId ? (record.secondaryReferenceKind ?? null) : null,
    payerName: record.payerName,
    lineItems: record.lineItems && record.lineItems.length > 0 ? record.lineItems : null,
  };
}
