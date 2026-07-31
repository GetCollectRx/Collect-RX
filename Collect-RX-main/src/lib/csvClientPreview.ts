/** Lightweight client-side CSV preview — mirrors server header alias names for UX only. */

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

export type CsvPreviewResult = {
  headers: string[]
  normalizedHeaders: string[]
  rowCount: number
  previewRows: Record<string, string>[]
  missingRequired: string[]
  missingRecommended: string[]
  ready: boolean
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
  }
}
