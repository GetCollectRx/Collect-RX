/**
 * Synthetic dental-office data for the office-day simulation.
 *
 * Everything here is invented. Names are deliberately awkward (apostrophes,
 * hyphens, accents, commas) because real front-desk exports contain them, and
 * a parser that only survives tidy names would pass a tidy fixture.
 */

export const OFFICE_HEADERS = [
  'claim_number',
  'patient_first_name',
  'patient_last_name',
  'patient_dob',
  'subscriber_id',
  'group_policy_number',
  'insurance_carrier',
  'procedure_code',
  'treatment_codes',
  'treatment_date',
  'submitted_date',
  'amount_billed',
  'amount_outstanding',
  'expected_amount',
  'days_outstanding',
] as const;

export type OfficeHeader = (typeof OFFICE_HEADERS)[number];
export type OfficeRow = Record<OfficeHeader, string>;

function csvField(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value;
}

export interface CsvStyle {
  bom?: boolean;
  crlf?: boolean;
  trailingBlankRows?: number;
}

export function toOfficeCsv(rows: OfficeRow[], style: CsvStyle = {}): string {
  const eol = style.crlf ? '\r\n' : '\n';
  const lines = [OFFICE_HEADERS.join(',')];
  for (const row of rows) lines.push(OFFICE_HEADERS.map((h) => csvField(row[h])).join(','));
  for (let i = 0; i < (style.trailingBlankRows ?? 0); i += 1) lines.push(OFFICE_HEADERS.map(() => '').join(','));
  return `${style.bom ? '﻿' : ''}${lines.join(eol)}${eol}`;
}

let counter = 0;

export interface RowOptions {
  claimNumber?: string;
  first?: string;
  last?: string;
  carrier?: string;
  group?: string;
  days?: number;
  outstanding?: string;
  billed?: string;
  treatmentCodes?: string;
  dob?: string;
}

/** A realistic claim row. Unique PHI values per row so leaks can be traced to a row. */
export function officeRow(tag: string, opts: RowOptions = {}): OfficeRow {
  counter += 1;
  const n = String(counter).padStart(4, '0');
  return {
    claim_number: opts.claimNumber ?? `OFC-${tag}-${n}`,
    patient_first_name: opts.first ?? `Zephyrine${n}`,
    patient_last_name: opts.last ?? `Quillfeather${n}`,
    patient_dob: opts.dob ?? '1984-03-17',
    subscriber_id: `SUBX${tag}${n}77`,
    group_policy_number: opts.group ?? `GRPX${n}`,
    insurance_carrier: opts.carrier ?? 'Sun Life',
    procedure_code: '21211',
    treatment_codes: opts.treatmentCodes ?? '21211;27211',
    treatment_date: '2026-09-02',
    submitted_date: '2026-09-04',
    amount_billed: opts.billed ?? '1180.00',
    amount_outstanding: opts.outstanding ?? '742.50',
    expected_amount: '742.50',
    days_outstanding: String(opts.days ?? 45),
  };
}

/** Carrier spellings a real office's PMS exports, mapped to what the product should resolve. */
export const CARRIER_SPELLINGS: ReadonlyArray<{ spelling: string; expected: string }> = [
  { spelling: 'Sun Life', expected: 'sun_life' },
  { spelling: 'SunLife', expected: 'sun_life' },
  { spelling: 'Sun Life Financial', expected: 'sun_life' },
  { spelling: 'Canada Life', expected: 'canada_life' },
  { spelling: 'Canada Life Assurance Company', expected: 'canada_life' },
  { spelling: 'Great-West Life', expected: 'canada_life' },
  { spelling: 'Manulife', expected: 'manulife' },
  { spelling: 'Manulife Financial', expected: 'manulife' },
  { spelling: 'Green Shield', expected: 'green_shield' },
  { spelling: 'GreenShield Canada', expected: 'green_shield' },
  { spelling: 'RBC Insurance', expected: 'rbc' },
  { spelling: 'RBC', expected: 'rbc' },
  { spelling: 'TELUS Health', expected: 'telus_adjudicare' },
  { spelling: 'TELUS AdjudiCare', expected: 'telus_adjudicare' },
  { spelling: 'Telus Adjudicare', expected: 'telus_adjudicare' },
];

export const AWKWARD_NAMES: ReadonlyArray<{ first: string; last: string }> = [
  { first: "Seán", last: "O'Brienquill-Tremblay" },
  { first: 'Zoë', last: 'Têtreault-Wrenfield' },
  { first: 'Mary Ann', last: 'D\'Arcangeliqua' },
  { first: 'Li', last: 'Oquendo, Vexley' },
];
