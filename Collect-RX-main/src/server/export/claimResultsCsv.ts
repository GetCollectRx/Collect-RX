export interface ClaimResultRow {
  claimNumber: string;
  carrierId: string;
  claimStatus: string;
  callCompletedAt: Date | null;
  callOutcome: string | null;
  resultSource: string | null;
  resultConfidence: string | null;
  referenceNumber: string | null;
  repName: string | null;
  durationSeconds: number | null;
}

export const CLAIM_RESULTS_CSV_HEADER: readonly string[] = [
  'claim_number',
  'carrier_id',
  'claim_status',
  'call_completed_at',
  'call_outcome',
  'result_source',
  'result_confidence',
  'carrier_reference_number',
  'carrier_rep_name',
  'call_duration_seconds',
];

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * Escape one CSV cell. Values that a spreadsheet would read as a formula get a
 * leading apostrophe, because rep names and reference numbers come from a phone
 * call and are untrusted text that staff will open in Excel.
 */
export function csvCell(value: string | number | Date | null): string {
  if (value === null) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === 'string' && FORMULA_PREFIX.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function buildClaimResultsCsv(rows: readonly ClaimResultRow[]): string {
  const lines = [CLAIM_RESULTS_CSV_HEADER.join(',')];
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.claimNumber),
        csvCell(r.carrierId),
        csvCell(r.claimStatus),
        csvCell(r.callCompletedAt),
        csvCell(r.callOutcome),
        csvCell(r.resultSource),
        csvCell(r.resultConfidence),
        csvCell(r.referenceNumber),
        csvCell(r.repName),
        csvCell(r.durationSeconds),
      ].join(','),
    );
  }
  return lines.join('\n');
}
