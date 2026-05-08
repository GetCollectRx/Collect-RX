import feeData from './feeGuides2026.json';

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
  lines: GapLineResult[];
  totalOfficeCad: number;
  totalCdcpScheduledCad: number;
  totalBalanceBillingGapCad: number;
}

function lookupFee(
  map: Record<string, number> | undefined,
  code: string
): number | null {
  if (!map) return null;
  const u = code.toUpperCase();
  if (map[u] != null) return map[u];
  const n = u.replace(/^D/, '');
  const padded = `D${n.padStart(4, '0')}`;
  return map[padded] ?? map[u] ?? null;
}

export function estimatePrecisionGap(
  province: ProvinceCode,
  procedures: GapLineInput[]
): GapEstimateSummary {
  const prov =
    feeData.provincialSuggestedFeesCad[province] ??
    feeData.provincialSuggestedFeesCad.ON;
  const cdcpMap = feeData.cdcpScheduleFeesCad as Record<string, number>;
  const provFees = prov.fees as Record<string, number>;

  const lines: GapLineResult[] = [];
  let totalOffice = 0;
  let totalCdcp = 0;
  let totalGap = 0;

  for (const p of procedures) {
    const normalized = p.cdtCode.trim().toUpperCase().startsWith('D')
      ? p.cdtCode.trim().toUpperCase()
      : `D${p.cdtCode.replace(/\D/g, '').padStart(4, '0')}`;
    const office = Number(p.officeFeeCad) || 0;
    const provincialSuggested = lookupFee(provFees, normalized);
    const cdcpFee = lookupFee(cdcpMap, normalized);

    const notes: string[] = [];
    if (province === 'AB') {
      notes.push(
        'Alberta has no mandatory provincial fee guide — office fees vary; treat spreads as directional.'
      );
    }
    if (provincialSuggested == null) {
      notes.push('Provincial suggested fee not in bundled dataset — ingest full fee guide for precision.');
    }
    if (cdcpFee == null) {
      notes.push('CDCP schedule fee not in bundled dataset — add Version 2 fee grid row for this code.');
    }

    const balanceBillingGap =
      cdcpFee != null ? Math.max(0, office - cdcpFee) : null;
    const scheduleSpread =
      provincialSuggested != null && cdcpFee != null
        ? provincialSuggested - cdcpFee
        : null;

    if (balanceBillingGap != null) totalGap += balanceBillingGap;
    totalOffice += office;
    if (cdcpFee != null) totalCdcp += cdcpFee;

    lines.push({
      cdtCode: p.cdtCode,
      normalizedCode: normalized,
      officeFeeCad: office,
      provincialSuggestedCad: provincialSuggested,
      cdcpScheduledCad: cdcpFee,
      balanceBillingGapCad: balanceBillingGap,
      scheduleSpreadCad: scheduleSpread,
      notes,
    });
  }

  return {
    effectiveDate: feeData.effectiveDate,
    province,
    provinceLabel: prov.label,
    lines,
    totalOfficeCad: totalOffice,
    totalCdcpScheduledCad: totalCdcp,
    totalBalanceBillingGapCad: totalGap,
  };
}
