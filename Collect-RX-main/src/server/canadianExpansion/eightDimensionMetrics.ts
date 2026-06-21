/**
 * 8-dimension dashboard — derived metrics from existing CollectRx tables.
 * Each dimension returns a numeric value plus a status (ok | watch | risk).
 *
 * Inputs are intentionally cheap counts/aggregations so this can run on every
 * dashboard load. When tables grow, swap individual queries for materialized views.
 */

import type { PrismaClient } from '@prisma/client';

export type DimensionStatus = 'ok' | 'watch' | 'risk';

export interface DimensionMetric {
  id: number;
  key: string;
  name: string;
  value: number | null;
  unit: 'pct' | 'count' | 'cad' | 'days';
  status: DimensionStatus;
  detail: string;
}


function asPct(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 100);
}

export async function computeEightDimensions(
  prisma: PrismaClient,
  practiceId: string
): Promise<DimensionMetric[]> {
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  // 1. CDCP adjudication success rate — won vs (won + lost) in active reconsideration cases
  const recCases = await prisma.cdcpReconsiderationCase.findMany({
    where: { practiceId, denialDate: { gte: yearStart } },
    select: { status: true },
  });
  const won = recCases.filter((c) => c.status === 'won').length;
  const lost = recCases.filter((c) => c.status === 'lost').length;
  const cdcpSuccess: DimensionMetric = {
    id: 1,
    key: 'cdcp_success_rate',
    name: 'CDCP adjudication success (Schedule B preauth)',
    value: asPct(won, won + lost),
    unit: 'pct',
    status: won + lost === 0 ? 'watch' : asPct(won, won + lost)! >= 50 ? 'ok' : 'risk',
    detail: `${won} won / ${lost} lost (YTD)`,
  };

  // 2. Provincial fee variance — count of imported AB rows (proxy for AB precision coverage)
  const abEntries = await prisma.feeGuideEntry.count({
    where: { scope: 'AB' },
  });
  const provinceVariance: DimensionMetric = {
    id: 2,
    key: 'ab_fee_variance_coverage',
    name: 'Provincial fee variance (Alberta coverage)',
    value: abEntries,
    unit: 'count',
    status: abEntries > 50 ? 'ok' : abEntries > 0 ? 'watch' : 'risk',
    detail: `${abEntries} AB fee guide rows imported`,
  };

  // 3. Reconsideration recovery value — patient AR removed; use insurance claim resolution as proxy
  const wonCases = await prisma.cdcpReconsiderationCase.findMany({
    where: { practiceId, status: 'won' },
    select: { patientToken: true },
  });
  const wonTokens = [...new Set(wonCases.map((c) => c.patientToken))];
  // Patient balance model removed — report won case count only
  const reconsiderationRecovery: DimensionMetric = {
    id: 3,
    key: 'reconsideration_recovery',
    name: 'Reconsideration recovery value',
    value: wonTokens.length,
    unit: 'count',
    status: wonTokens.length > 0 ? 'ok' : 'watch',
    detail: `${wonTokens.length} won reconsideration case(s) YTD`,
  };

  // 4. Claim age — insurance claims approaching 12-month resubmission limit
  const elevenMonthsAgo = new Date(now.getTime() - 335 * 86_400_000);
  const agedCount = await prisma.insuranceClaim.count({
    where: {
      practiceId,
      status: { not: 'RESOLVED' },
      createdAt: { lt: elevenMonthsAgo },
    },
  });
  const claimAge: DimensionMetric = {
    id: 4,
    key: 'claim_age_12_month',
    name: 'Claims approaching 12-month resubmission limit',
    value: agedCount,
    unit: 'count',
    status: agedCount === 0 ? 'ok' : agedCount < 5 ? 'watch' : 'risk',
    detail: agedCount === 0 ? 'No aged claims' : `${agedCount} insurance claim(s) ≥ 11 months old`,
  };

  // 5. Denture frequency — patient AR removed; not computable without PatientBalance
  const dentureFrequency: DimensionMetric = {
    id: 5,
    key: 'cdcp_denture_frequency',
    name: '96-month complete-denture frequency monitor',
    value: null,
    unit: 'count',
    status: 'watch',
    detail: 'Not available — requires procedure-level claim data',
  };

  // 6. Lab fee margin — patient AR removed; not computable without PatientBalance
  const labFee: DimensionMetric = {
    id: 6,
    key: 'lab_fee_margin',
    name: 'Lab fee margin (April 2026 schedule)',
    value: null,
    unit: 'count',
    status: 'watch',
    detail: 'Not available — requires procedure-level claim data',
  };

  // 7. Sedation utilization — patient AR removed; not computable without PatientBalance
  const sedation: DimensionMetric = {
    id: 7,
    key: 'sedation_utilization',
    name: 'Sedation sessions vs CDCP preauth threshold',
    value: null,
    unit: 'count',
    status: 'watch',
    detail: 'Not available — requires procedure-level claim data',
  };

  // 8. COB / wraparound efficiency — insurance claim resolution rate as proxy
  const [totalClaims, resolvedClaims] = await Promise.all([
    prisma.insuranceClaim.count({ where: { practiceId } }),
    prisma.insuranceClaim.count({ where: { practiceId, status: 'RESOLVED' } }),
  ]);
  const cobValue = asPct(resolvedClaims, totalClaims);
  const cobEfficiency: DimensionMetric = {
    id: 8,
    key: 'cob_efficiency',
    name: 'Insurance claim resolution rate',
    value: cobValue,
    unit: 'pct',
    status:
      cobValue == null ? 'watch' : cobValue >= 70 ? 'ok' : cobValue >= 40 ? 'watch' : 'risk',
    detail: `${resolvedClaims}/${totalClaims} insurance claims resolved`,
  };

  return [
    cdcpSuccess,
    provinceVariance,
    reconsiderationRecovery,
    claimAge,
    dentureFrequency,
    labFee,
    sedation,
    cobEfficiency,
  ];
}
