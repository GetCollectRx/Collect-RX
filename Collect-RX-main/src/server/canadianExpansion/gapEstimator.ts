import type { PrismaClient } from '@prisma/client';
import bundled from './feeGuides2026.json';
import { getFeeMap, type FeeMap, type Scope } from './feeGuideRepo';

export type ProvinceCode = 'ON' | 'BC' | 'AB';

export interface GapLineInput {
  cdtCode: string;
  /** Office/UCR fee charged or planned */
  officeFeeCad: number;
}

export interface GapLineResult {
  cdtCode: string;
  normalizedCode: string;
  officeFeeCad: number;
  provincialSuggestedCad: number | null;
  cdcpScheduledCad: number | null;
  /** Patient balance-billing exposure vs CDCP schedule (office fee − CDCP reimbursement snapshot). */
  balanceBillingGapCad: number | null;
  /** Provincial suggested − CDCP schedule (pricing pressure indicator). */
  scheduleSpreadCad: number | null;
  notes: string[];
}

export interface GapEstimateSummary {
  effectiveDate: string;
  province: ProvinceCode;
  provinceLabel: string;
  feeSource: { provincial: 'database' | 'bundled'; cdcp: 'database' | 'bundled' };
  lines: GapLineResult[];
  totalOfficeCad: number;
  totalCdcpScheduledCad: number;
  totalBalanceBillingGapCad: number;
}

const PROVINCE_LABELS: Record<ProvinceCode, string> = {
  ON: 'Ontario',
  BC: 'British Columbia',
  AB: 'Alberta',
};

function normalizeKey(code: string): string {
  const u = code.trim().toUpperCase();
  if (u.startsWith('D')) return u;
  const digits = u.replace(/\D/g, '');
  return digits ? `D${digits.padStart(4, '0')}` : u;
}

function lookupFee(map: Record<string, number>, code: string): number | null {
  if (!map) return null;
  if (map[code] != null) return map[code];
  const norm = normalizeKey(code);
  return map[norm] ?? null;
}

/**
 * Synchronous bundled-only estimator. Kept for unit tests / offline use.
 */
export function estimatePrecisionGap(
  province: ProvinceCode,
  procedures: GapLineInput[]
): GapEstimateSummary {
  const provFees =
    (bundled.provincialSuggestedFeesCad[province]?.fees as Record<string, number>) || {};
  const cdcpMap = bundled.cdcpScheduleFeesCad as Record<string, number>;
  return computeGap({
    province,
    provinceLabel: PROVINCE_LABELS[province],
    effectiveDate: bundled.effectiveDate,
    feeSource: { provincial: 'bundled', cdcp: 'bundled' },
    provFees,
    cdcpMap,
    procedures,
  });
}

/**
 * Async DB-aware estimator: pulls latest fee guide per scope, falls back to bundled.
 */
export async function estimatePrecisionGapWithDb(
  prisma: PrismaClient,
  province: ProvinceCode,
  procedures: GapLineInput[],
  asOf: Date = new Date()
): Promise<GapEstimateSummary> {
  const [provincial, cdcp] = await Promise.all([
    getFeeMap(prisma, province as Scope, asOf),
    getFeeMap(prisma, 'CDCP', asOf),
  ]);
  const effectiveDate = provincial.source === 'database' ? provincial.effectiveDate : cdcp.effectiveDate;
  return computeGap({
    province,
    provinceLabel: PROVINCE_LABELS[province],
    effectiveDate,
    feeSource: {
      provincial: provincial.source,
      cdcp: cdcp.source,
    },
    provFees: provincial.fees,
    cdcpMap: cdcp.fees,
    procedures,
  });
}

interface ComputeArgs {
  province: ProvinceCode;
  provinceLabel: string;
  effectiveDate: string;
  feeSource: GapEstimateSummary['feeSource'];
  provFees: FeeMap['fees'];
  cdcpMap: FeeMap['fees'];
  procedures: GapLineInput[];
}

function computeGap(args: ComputeArgs): GapEstimateSummary {
  const lines: GapLineResult[] = [];
  let totalOffice = 0;
  let totalCdcp = 0;
  let totalGap = 0;

  for (const p of args.procedures) {
    const office = Number(p.officeFeeCad) || 0;
    const provincialSuggested = lookupFee(args.provFees, p.cdtCode);
    const cdcpFee = lookupFee(args.cdcpMap, p.cdtCode);

    const notes: string[] = [];
    if (args.province === 'AB') {
      notes.push(
        'Alberta has no mandatory provincial fee guide — office fees vary; treat spreads as directional.'
      );
    }
    if (provincialSuggested == null) {
      notes.push(
        args.feeSource.provincial === 'bundled'
          ? 'Provincial suggested fee not in bundled dataset — import full guide for precision.'
          : 'Provincial suggested fee missing from imported guide — verify CSV row coverage.'
      );
    }
    if (cdcpFee == null) {
      notes.push(
        args.feeSource.cdcp === 'bundled'
          ? 'CDCP schedule fee not in bundled dataset — import April 2026 schedule.'
          : 'CDCP schedule fee missing from imported guide — verify CSV row coverage.'
      );
    }

    const balanceBillingGap = cdcpFee != null ? Math.max(0, office - cdcpFee) : null;
    const scheduleSpread =
      provincialSuggested != null && cdcpFee != null ? provincialSuggested - cdcpFee : null;

    if (balanceBillingGap != null) totalGap += balanceBillingGap;
    totalOffice += office;
    if (cdcpFee != null) totalCdcp += cdcpFee;

    lines.push({
      cdtCode: p.cdtCode,
      normalizedCode: normalizeKey(p.cdtCode),
      officeFeeCad: office,
      provincialSuggestedCad: provincialSuggested,
      cdcpScheduledCad: cdcpFee,
      balanceBillingGapCad: balanceBillingGap,
      scheduleSpreadCad: scheduleSpread,
      notes,
    });
  }

  return {
    effectiveDate: args.effectiveDate,
    province: args.province,
    provinceLabel: args.provinceLabel,
    feeSource: args.feeSource,
    lines,
    totalOfficeCad: totalOffice,
    totalCdcpScheduledCad: totalCdcp,
    totalBalanceBillingGapCad: totalGap,
  };
}
