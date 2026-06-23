/**
 * MOD-03 — DB-backed fee guide repository. Falls back to bundled illustrative JSON
 * when no rows exist for a (scope, effectiveDate) bucket.
 */

import type { PrismaClient } from '@prisma/client';
import bundled from './feeGuides2026.json';

export type Scope = 'CDCP' | 'ON' | 'BC' | 'AB';

export interface FeeMap {
  source: 'database' | 'bundled';
  effectiveDate: string;
  fees: Record<string, number>;
}

const BUNDLED_EFFECTIVE = bundled.effectiveDate;

function bundledFor(scope: Scope): FeeMap {
  if (scope === 'CDCP') {
    return {
      source: 'bundled',
      effectiveDate: BUNDLED_EFFECTIVE,
      fees: bundled.cdcpScheduleFeesCad as Record<string, number>,
    };
  }
  const provData = bundled.provincialSuggestedFeesCad[scope];
  return {
    source: 'bundled',
    effectiveDate: BUNDLED_EFFECTIVE,
    fees: (provData?.fees as Record<string, number>) || {},
  };
}

/**
 * Returns the most recent fee map for `scope` whose effectiveDate is on or before `asOf`.
 */
export async function getFeeMap(
  prisma: PrismaClient,
  scope: Scope,
  asOf: Date = new Date()
): Promise<FeeMap> {
  const latest = await prisma.feeGuideEntry.findFirst({
    where: { scope, effectiveDate: { lte: asOf } },
    orderBy: { effectiveDate: 'desc' },
    select: { effectiveDate: true },
  });
  if (!latest) {
    return bundledFor(scope);
  }
  const rows = await prisma.feeGuideEntry.findMany({
    where: { scope, effectiveDate: latest.effectiveDate },
    select: { cdtCode: true, feeCad: true },
  });
  const fees: Record<string, number> = {};
  for (const r of rows) fees[r.cdtCode] = r.feeCad;
  return {
    source: 'database',
    effectiveDate: latest.effectiveDate.toISOString().split('T')[0]!,
    fees,
  };
}

export interface FeeImportRow {
  cdtCode: string;
  feeCad: number;
  source?: string | null;
  notes?: string | null;
}

const CDT_RE = /^D?\d{3,5}$/;

export function parseFeeRows(parsed: Array<Record<string, string>>): {
  rows: FeeImportRow[];
  errors: string[];
} {
  const rows: FeeImportRow[] = [];
  const errors: string[] = [];
  parsed.forEach((p, i) => {
    const code = (p.cdt_code || p.code || p.procedure_code || '').trim().toUpperCase();
    const feeRaw = (p.fee_cad || p.fee || p.suggested_fee || p.amount || '').replace(/[$,]/g, '').trim();
    const fee = parseFloat(feeRaw);
    if (!CDT_RE.test(code)) {
      errors.push(`row ${i + 2}: invalid CDT code "${code}"`);
      return;
    }
    if (!Number.isFinite(fee) || fee < 0 || fee > 100_000) {
      errors.push(`row ${i + 2}: invalid fee_cad "${feeRaw}"`);
      return;
    }
    const cdtCode = code.startsWith('D') ? code : `D${code.padStart(4, '0')}`;
    rows.push({
      cdtCode,
      feeCad: fee,
      source: (p.source || '').trim() || null,
      notes: (p.notes || '').trim() || null,
    });
  });
  return { rows, errors };
}

export async function importFeeGuide(
  prisma: PrismaClient,
  scope: Scope,
  effectiveDate: Date,
  rows: FeeImportRow[]
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    const existing = await prisma.feeGuideEntry.findUnique({
      where: {
        scope_effectiveDate_cdtCode: {
          scope,
          effectiveDate,
          cdtCode: row.cdtCode,
        },
      },
      select: { id: true },
    });
    if (existing) {
      await prisma.feeGuideEntry.update({
        where: { id: existing.id },
        data: {
          feeCad: row.feeCad,
          source: row.source ?? null,
          notes: row.notes ?? null,
        },
      });
      updated += 1;
    } else {
      await prisma.feeGuideEntry.create({
        data: {
          scope,
          effectiveDate,
          cdtCode: row.cdtCode,
          feeCad: row.feeCad,
          source: row.source ?? null,
          notes: row.notes ?? null,
        },
      });
      inserted += 1;
    }
  }
  return { inserted, updated };
}
