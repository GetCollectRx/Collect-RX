/**
 * Import CDCP predetermination denial rows from CSV or JSON — no PMS required.
 * Idempotent on (practiceId, claimRef).
 */
import type { PrismaClient } from '@prisma/client';
import { deriveInitialStatus } from '../canadianExpansion/reconsideration.js';
import { normalizeCdtCode } from '../canadianExpansion/constants.js';

export interface CdcpPredetImportRow {
  claimRef: string;
  patientToken: string;
  procedureCode: string;
  denialDate: Date;
  clinicalEvidenceSummary?: string;
  status?: string;
}

export interface CdcpPredetImportResult {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; claimRef?: string; error: string }>;
}

const ROW_ALIASES: Record<string, keyof CdcpPredetImportRow | 'denialDateRaw'> = {
  claim_ref: 'claimRef',
  predet_ref: 'claimRef',
  predetermination_ref: 'claimRef',
  claim_id: 'claimRef',
  patient_token: 'patientToken',
  patient_id: 'patientToken',
  procedure_code: 'procedureCode',
  cdt_code: 'procedureCode',
  procedure: 'procedureCode',
  denial_date: 'denialDateRaw',
  date_denied: 'denialDateRaw',
  denied_at: 'denialDateRaw',
  clinical_evidence_summary: 'clinicalEvidenceSummary',
  denial_reason: 'clinicalEvidenceSummary',
  notes: 'clinicalEvidenceSummary',
  status: 'status',
};

type ParsedRow = Partial<CdcpPredetImportRow> & { denialDateRaw?: string };

function parseDenialDate(raw: string): Date | null {
  const t = raw.trim();
  if (!t) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(t);
  if (iso) {
    const d = new Date(`${t}T12:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mapRecordToRow(record: Record<string, unknown>, rowIndex: number): {
  row?: CdcpPredetImportRow;
  error?: string;
} {
  const parsed: ParsedRow = {};

  for (const [key, value] of Object.entries(record)) {
    const canonical = ROW_ALIASES[key.toLowerCase().trim()];
    if (!canonical || value === undefined || value === null || value === '') continue;
    if (canonical === 'denialDateRaw') {
      parsed.denialDateRaw = String(value);
    } else if (canonical === 'claimRef' || canonical === 'patientToken' || canonical === 'procedureCode' || canonical === 'clinicalEvidenceSummary' || canonical === 'status') {
      parsed[canonical] = String(value).trim();
    }
  }

  if (!parsed.claimRef) {
    return { error: `Row ${rowIndex}: claim_ref is required` };
  }
  if (!parsed.patientToken) {
    return { error: `Row ${rowIndex}: patient_token is required` };
  }
  if (!parsed.procedureCode) {
    return { error: `Row ${rowIndex}: procedure_code is required` };
  }
  if (!parsed.denialDateRaw) {
    return { error: `Row ${rowIndex}: denial_date is required` };
  }

  const denialDate = parseDenialDate(parsed.denialDateRaw);
  if (!denialDate) {
    return { error: `Row ${rowIndex}: invalid denial_date "${parsed.denialDateRaw}"` };
  }

  return {
    row: {
      claimRef: parsed.claimRef,
      patientToken: parsed.patientToken,
      procedureCode: normalizeCdtCode(parsed.procedureCode),
      denialDate,
      clinicalEvidenceSummary: parsed.clinicalEvidenceSummary,
      status: parsed.status,
    },
  };
}

export function parseCdcpPredetCsvRows(records: Record<string, unknown>[]): {
  rows: CdcpPredetImportRow[];
  errors: Array<{ row: number; claimRef?: string; error: string }>;
} {
  const rows: CdcpPredetImportRow[] = [];
  const errors: Array<{ row: number; claimRef?: string; error: string }> = [];

  records.forEach((record, idx) => {
    const rowIndex = idx + 2; // header is row 1
    const { row, error } = mapRecordToRow(record, rowIndex);
    if (error) {
      errors.push({ row: rowIndex, claimRef: typeof record.claim_ref === 'string' ? record.claim_ref : undefined, error });
    } else if (row) {
      rows.push(row);
    }
  });

  return { rows, errors };
}

export async function importCdcpPredetCases(
  prisma: PrismaClient,
  practiceId: string,
  rows: CdcpPredetImportRow[],
): Promise<CdcpPredetImportResult> {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: CdcpPredetImportResult['errors'] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const init = deriveInitialStatus(row.procedureCode);
      const status = row.status?.trim() || init.status;
      const exclusionReason = init.exclusionReason;

      const existing = await prisma.cdcpReconsiderationCase.findFirst({
        where: { practiceId, claimRef: row.claimRef },
      });

      if (existing) {
        await prisma.cdcpReconsiderationCase.update({
          where: { id: existing.id },
          data: {
            patientToken: row.patientToken,
            procedureCode: row.procedureCode,
            denialDate: row.denialDate,
            status,
            exclusionReason,
            clinicalEvidenceSummary:
              row.clinicalEvidenceSummary ??
              existing.clinicalEvidenceSummary ??
              `Imported predet denial — ${row.procedureCode}`,
          },
        });
        updated += 1;
      } else {
        await prisma.cdcpReconsiderationCase.create({
          data: {
            practiceId,
            patientToken: row.patientToken,
            claimRef: row.claimRef,
            carrierCode: 'cdcp_sunlife',
            procedureCode: row.procedureCode,
            denialDate: row.denialDate,
            status,
            exclusionReason,
            clinicalEvidenceSummary:
              row.clinicalEvidenceSummary ??
              `Imported predet denial — ${row.procedureCode}`,
          },
        });
        created += 1;
      }
    } catch (e) {
      skipped += 1;
      errors.push({
        row: i + 1,
        claimRef: row.claimRef,
        error: (e as Error).message,
      });
    }
  }

  return {
    processed: rows.length,
    created,
    updated,
    skipped,
    errors,
  };
}
