/** Lightweight client-side CSV preview — mirrors server header alias names for UX only. */

import { resolveRowPayerType, type PayerTypeValue } from './payerTypeInput'

const REQUIRED_HINTS = [
  'claim_number',
  'id',
  'carrier_code',
  'carrier_name',
  'amount_outstanding',
  'patient_first_name',
  'procedure_code',
]

const RECOMMENDED_HINTS = [
  'submission_date',
  'days_outstanding',
  'status',
  'amount_billed',
  'patient_last_name',
]

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, '_').replace(/"/g, '')
}

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (ch === '"') {
      inQ = !inQ
      continue
    }
    if (ch === ',' && !inQ) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur)
  return out
}

const PAYER_TYPE_KEYS = ['payer_type', 'payer_program', 'plan_type', 'funding_type']
const PLAN_NAME_KEYS = [
  'carrier_name',
  'carrier',
  'insurance_carrier',
  'insurance_company',
  'insurance',
  'primary_insurance',
  'ins_carrier',
  'ins_company',
  'plan_name',
  'carrier_code',
]

export type PayerTypeSummary = {
  /** Rows classified by their own Payer Type cell or a plan name that says CDCP. */
  counts: Record<PayerTypeValue, number>
  /** Rows that carry no program of their own and need the file-level choice. */
  unclassified: number
  /** Rows the server would reject: an unrecognized value, or a cell that conflicts with the plan name. `row` is the spreadsheet row (header is row 1). */
  problems: { row: number; message: string }[]
}

function firstCell(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k]
    if (v && v.trim() !== '') return v
  }
  return ''
}

/** Classify every row the way the server will, so the screen can say so before importing. */
export function summarizePayerTypes(rows: Record<string, string>[]): PayerTypeSummary {
  const summary: PayerTypeSummary = { counts: { PRIVATE: 0, CDCP: 0, PROVINCIAL: 0 }, unclassified: 0, problems: [] }
  rows.forEach((row, i) => {
    const resolved = resolveRowPayerType(firstCell(row, PAYER_TYPE_KEYS), firstCell(row, PLAN_NAME_KEYS))
    if (!resolved.ok) {
      summary.problems.push({ row: i + 2, message: resolved.error })
    } else if (resolved.value) {
      summary.counts[resolved.value] += 1
    } else {
      summary.unclassified += 1
    }
  })
  return summary
}

/**
 * Why this file cannot be imported yet, or null. A file is ready when no row is
 * invalid and every row has a program, either its own or the one chosen for the
 * file. There is no default: with unclassified rows, the person must choose.
 */
export function payerTypeBlockReason(summary: PayerTypeSummary, chosen: string): string | null {
  if (summary.problems.length > 0) {
    return `${summary.problems.length} row${summary.problems.length === 1 ? ' has' : 's have'} a payer type problem. Fix the file and choose it again.`
  }
  if (summary.unclassified > 0 && !chosen) {
    return `Choose a payer program for the ${summary.unclassified} row${summary.unclassified === 1 ? '' : 's'} that ${summary.unclassified === 1 ? 'has' : 'have'} none.`
  }
  return null
}

export type CsvPreviewResult = {
  headers: string[]
  normalizedHeaders: string[]
  rowCount: number
  previewRows: Record<string, string>[]
  missingRequired: string[]
  missingRecommended: string[]
  ready: boolean
  payerTypes: PayerTypeSummary
}

export function previewCsvFile(text: string, previewLimit = 5): CsvPreviewResult {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) {
    return {
      headers: [],
      normalizedHeaders: [],
      rowCount: 0,
      previewRows: [],
      missingRequired: REQUIRED_HINTS.slice(0, 3),
      missingRecommended: RECOMMENDED_HINTS,
      ready: false,
      payerTypes: { counts: { PRIVATE: 0, CDCP: 0, PROVINCIAL: 0 }, unclassified: 0, problems: [] },
    }
  }

  const headers = splitCsvLine(lines[0]!)
  const normalizedHeaders = headers.map(normalizeHeader)
  const has = (keys: string[]) => keys.some((k) => normalizedHeaders.includes(k))

  const missingRequired: string[] = []
  if (!has(['claim_number', 'id'])) missingRequired.push('claim id (claim_number or id)')
  if (!has(['carrier_code', 'carrier_name', 'carrier'])) missingRequired.push('carrier (carrier_code or carrier_name)')
  if (!has(['amount_outstanding', 'outstanding_amount', 'balance'])) {
    missingRequired.push('outstanding amount (amount_outstanding)')
  }

  const missingRecommended = RECOMMENDED_HINTS.filter((h) => !normalizedHeaders.includes(h))

  const previewRows: Record<string, string>[] = []
  for (let r = 1; r < Math.min(lines.length, previewLimit + 1); r++) {
    const cols = splitCsvLine(lines[r]!)
    const row: Record<string, string> = {}
    normalizedHeaders.forEach((h, j) => {
      row[h] = (cols[j] ?? '').replace(/^"|"$/g, '').trim()
    })
    previewRows.push(row)
  }

  return {
    headers,
    normalizedHeaders,
    rowCount: lines.length - 1,
    previewRows,
    missingRequired,
    missingRecommended,
    ready: missingRequired.length === 0,
    payerTypes: summarizePayerTypes(parseCsvFile(text)),
  }
}

/** Full-file parse (every row, not just the preview slice) for building a batch-import payload. */
export function parseCsvFile(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return []

  const normalizedHeaders = splitCsvLine(lines[0]!).map(normalizeHeader)
  const rows: Record<string, string>[] = []
  for (let r = 1; r < lines.length; r++) {
    const cols = splitCsvLine(lines[r]!)
    const row: Record<string, string> = {}
    normalizedHeaders.forEach((h, j) => {
      row[h] = (cols[j] ?? '').replace(/^"|"$/g, '').trim()
    })
    rows.push(row)
  }
  return rows
}
