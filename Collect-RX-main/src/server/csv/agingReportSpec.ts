/**
 * The aging report CollectRx accepts, and the strict check that decides whether a file is accepted at all.
 *
 * The importer reads a fixed set of header spellings. A file whose required columns are missing, empty,
 * ambiguous or duplicated is refused whole, with a reason per problem. Nothing is imported and no row is
 * guessed at. The key lists are the importer's own (parseExportRows.ts), so what staff are told is
 * required is exactly what the importer will look for.
 *
 * Row-level problems (a blank DOB on one claim, an unknown carrier) are not decided here: those rows are
 * held back with a reason by the import pipeline while the rest of a sound file imports.
 */
import {
  CARRIER_KEYS,
  CLAIM_ID_KEYS,
  DAYS_OUTSTANDING_KEYS,
  DOB_KEYS,
  FIRST_NAME_KEYS,
  LAST_NAME_KEYS,
  OUTSTANDING_KEYS,
  SERVICE_DATE_KEYS,
  SUBMITTED_DATE_KEYS,
  SUBSCRIBER_ID_KEYS,
  keyVariants,
} from '../pms/parseExportRows.js';
import { HEADER_ALIASES } from './parseSimple.js';

export interface AgingReportField {
  id: string;
  /** The column name to use. Always accepted. */
  preferred: string;
  label: string;
  meaning: string;
  example: string;
  /** The importer's header spellings for this field. */
  keys: readonly string[];
  /** The field may be satisfied by several columns at once (claim age: a day count or either date). */
  allowSeveral?: boolean;
}

export const AGING_REPORT_FIELDS: readonly AgingReportField[] = [
  { id: 'claim_number', preferred: 'claim_number', label: 'Claim number', meaning: 'The ID or reference your system gives each insurance claim. One value per claim.', example: 'CLM-10482', keys: CLAIM_ID_KEYS.generic },
  { id: 'insurance_carrier', preferred: 'insurance_carrier', label: 'Insurance carrier', meaning: 'The insurer the claim was sent to. Supported: Sun Life, Canada Life, Manulife, Green Shield, RBC Insurance, TELUS AdjudiCare.', example: 'Manulife', keys: CARRIER_KEYS },
  { id: 'patient_first_name', preferred: 'patient_first_name', label: 'Patient first name', meaning: 'Needed by the carrier to find the claim. Never sent to the voice service in call metadata.', example: 'Alex', keys: FIRST_NAME_KEYS },
  { id: 'patient_last_name', preferred: 'patient_last_name', label: 'Patient last name', meaning: 'Needed by the carrier to find the claim.', example: 'Morgan', keys: LAST_NAME_KEYS },
  { id: 'patient_dob', preferred: 'patient_dob', label: 'Patient date of birth', meaning: 'Needed by the carrier to confirm identity. Use YYYY-MM-DD.', example: '1984-03-17', keys: DOB_KEYS },
  { id: 'subscriber_id', preferred: 'subscriber_id', label: 'Member or policy ID', meaning: 'The member, certificate or policy number on the patient insurance card.', example: '9900002277', keys: SUBSCRIBER_ID_KEYS },
  { id: 'amount_outstanding', preferred: 'amount_outstanding', label: 'Insurance amount outstanding', meaning: 'What the insurer still owes on the claim, not the patient balance. Plain number, for example 742.50.', example: '742.50', keys: OUTSTANDING_KEYS },
  {
    id: 'claim_age',
    preferred: 'days_outstanding',
    label: 'Claim age',
    meaning: 'How old the claim is: a day count (days_outstanding), the date it was submitted (submission_date), or the date of service (treatment_date). At least one is needed.',
    example: '45',
    keys: [...DAYS_OUTSTANDING_KEYS, ...SUBMITTED_DATE_KEYS, ...SERVICE_DATE_KEYS],
    allowSeveral: true,
  },
];

export type AgingReportProblemCode = 'NO_DATA_ROWS' | 'MISSING_COLUMN' | 'EMPTY_COLUMN' | 'DUPLICATE_COLUMN' | 'AMBIGUOUS_COLUMN';

export interface AgingReportProblem {
  code: AgingReportProblemCode;
  /** Field id, or null when the problem is about the whole file. */
  field: string | null;
  message: string;
  suggestion?: string;
}

export interface AgingReportCheck {
  ok: boolean;
  problems: AgingReportProblem[];
  rowCount: number;
}

function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur: number[] = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      cur.push(Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, substitution));
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

/** The columns of the file that this field's keys match, using the importer's own lookup variants. */
function matchedColumns(field: AgingReportField, columns: ReadonlySet<string>): string[] {
  const found = new Set<string>();
  for (const k of field.keys) {
    for (const variant of keyVariants(k)) {
      if (columns.has(variant)) found.add(variant);
    }
  }
  return [...found];
}

function suggestionFor(field: AgingReportField, columns: readonly string[], claimed: ReadonlySet<string>): string | undefined {
  if (field.id === 'amount_outstanding' && columns.includes('patient_owes')) {
    return 'A column named balance or patient_owes is read as the patient\'s own balance, not what the insurer owes. Rename the insurance amount column to amount_outstanding.';
  }
  let best: { column: string; d: number } | null = null;
  for (const column of columns) {
    if (claimed.has(column)) continue;
    const d = distance(column, field.preferred);
    if (d <= 3 && (best === null || d < best.d)) best = { column, d };
  }
  return best ? `Your file has a column named "${best.column}". Rename it to ${field.preferred}.` : undefined;
}

/**
 * @param headers the file's column names after the importer's normalization, duplicates kept
 * @param rows the parsed data rows, keyed by those names
 */
export function checkAgingReport(headers: readonly string[], rows: readonly Record<string, string>[]): AgingReportCheck {
  const problems: AgingReportProblem[] = [];
  if (rows.length === 0) {
    problems.push({ code: 'NO_DATA_ROWS', field: null, message: 'The file has no claim rows. The first row must be the column names, with one claim per row below it.' });
    return { ok: false, problems, rowCount: 0 };
  }

  const counts = new Map<string, number>();
  for (const h of headers) counts.set(h, (counts.get(h) ?? 0) + 1);
  for (const [name, n] of counts) {
    if (n > 1) {
      problems.push({ code: 'DUPLICATE_COLUMN', field: null, message: `The column "${name}" appears ${n} times. Remove or rename the extras so each column name is used once.` });
    }
  }

  const columns = new Set(headers);
  const claimed = new Set<string>();
  for (const f of AGING_REPORT_FIELDS) for (const c of matchedColumns(f, columns)) claimed.add(c);

  for (const field of AGING_REPORT_FIELDS) {
    const present = matchedColumns(field, columns);
    if (present.length === 0) {
      problems.push({
        code: 'MISSING_COLUMN',
        field: field.id,
        message: `Missing the ${field.label.toLowerCase()} column. ${field.meaning}`,
        suggestion: suggestionFor(field, headers, claimed) ?? `Add a column named ${field.preferred}.`,
      });
      continue;
    }
    if (!field.allowSeveral && present.length > 1) {
      problems.push({
        code: 'AMBIGUOUS_COLUMN',
        field: field.id,
        message: `Two columns look like the ${field.label.toLowerCase()} (${present.join(', ')}), so the file cannot say which one to use.`,
        suggestion: `Keep one, named ${field.preferred}, and remove the other.`,
      });
      continue;
    }
    const filled = rows.some((row) => present.some((c) => (row[c] ?? '').trim() !== ''));
    if (!filled) {
      problems.push({
        code: 'EMPTY_COLUMN',
        field: field.id,
        message: `The ${field.label.toLowerCase()} column (${present.join(', ')}) is empty on every row.`,
        suggestion: 'Fill it in from your system, then upload again.',
      });
    }
  }
  return { ok: problems.length === 0, problems, rowCount: rows.length };
}

/** Header row staff can download and fill in. Required columns first. */
export function agingReportTemplateHeader(): string {
  return AGING_REPORT_FIELDS.map((f) => f.preferred).concat(['amount_billed', 'submission_date', 'procedure_code']).join(',');
}

/** What the screen shows: each required column, what it means, and which names are also accepted. */
export function describeAgingReportSpec(): Array<{ id: string; column: string; label: string; meaning: string; example: string; alsoAccepted: string[] }> {
  return AGING_REPORT_FIELDS.map((f) => {
    const direct = f.keys.map((k) => k.trim().toLowerCase().replace(/\s+/g, '_'));
    const viaAlias = Object.entries(HEADER_ALIASES).filter(([, canonical]) => f.keys.map((k) => k.toLowerCase()).includes(canonical)).map(([alias]) => alias);
    const also = [...new Set([...direct, ...viaAlias])].filter((k) => k !== f.preferred).sort();
    return { id: f.id, column: f.preferred, label: f.label, meaning: f.meaning, example: f.example, alsoAccepted: also };
  });
}
