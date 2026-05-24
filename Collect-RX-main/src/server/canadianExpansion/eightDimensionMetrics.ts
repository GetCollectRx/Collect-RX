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

const NITROUS_OXIDE_CODES = new Set(['D9230', 'D9240']);
const COMPLETE_DENTURE_CODES = new Set(['D5110', 'D5120']);
const LAB_FEE_PROC_PREFIX = /^D5|^D6|^D8/;

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

  // 3. Reconsideration recovery value — sum of patientOwes recovered through 'won' cases
  // Approximation: outstanding balances on patients tied to won cases that are now paid.
  const wonCases = await prisma.cdcpReconsiderationCase.findMany({
    where: { practiceId, status: 'won' },
    select: { patientToken: true },
  });
  const wonTokens = [...new Set(wonCases.map((c) => c.patientToken))];
  let recoveryCad = 0;
  if (wonTokens.length > 0) {
    const recoveredBalances = await prisma.patientBalance.findMany({
      where: { patientToken: { in: wonTokens }, paymentStatus: 'paid' },
      select: { amountPaid: true },
    });
    recoveryCad = recoveredBalances.reduce((sum, r) => sum + Number(r.amountPaid || 0), 0);
  }
  const reconsiderationRecovery: DimensionMetric = {
    id: 3,
    key: 'reconsideration_recovery',
    name: 'Reconsideration recovery value',
    value: Math.round(recoveryCad * 100) / 100,
    unit: 'cad',
    status: recoveryCad > 0 ? 'ok' : 'watch',
    detail: `${wonTokens.length} won case patients · CA$${recoveryCad.toFixed(0)} recovered`,
  };

  // 4. Claim age — count of balances older than 11 months (approaching 12-month resubmission limit)
  const elevenMonthsAgo = new Date(now.getTime() - 335 * 86_400_000);
  const agedCount = await prisma.patientBalance.count({
    where: {
      practiceId,
      paymentStatus: { not: 'paid' },
      treatmentDate: { lt: elevenMonthsAgo, not: null },
    },
  });
  const claimAge: DimensionMetric = {
    id: 4,
    key: 'claim_age_12_month',
    name: 'Claims approaching 12-month resubmission limit',
    value: agedCount,
    unit: 'count',
    status: agedCount === 0 ? 'ok' : agedCount < 5 ? 'watch' : 'risk',
    detail: agedCount === 0 ? 'No aged claims' : `${agedCount} claim(s) ≥ 11 months old`,
  };

  // 5. 96-month denture frequency — count of complete-denture procedures in past 90 days for cdcp_sunlife
  const recentDentures = await prisma.patientBalance.count({
    where: {
      practiceId,
      carrierCode: 'cdcp_sunlife',
      procedureCode: { in: [...COMPLETE_DENTURE_CODES] },
      treatmentDate: { gte: ninetyDaysAgo },
    },
  });
  const dentureFrequency: DimensionMetric = {
    id: 5,
    key: 'cdcp_denture_frequency',
    name: '96-month complete-denture frequency monitor',
    value: recentDentures,
    unit: 'count',
    status: recentDentures === 0 ? 'ok' : 'watch',
    detail: `${recentDentures} complete-denture claim(s) for CDCP patients in last 90 days`,
  };

  // 6. Lab fee margin — proxy: count of major prosthetic/lab-driven procedures in past 90 days
  const labFeeRows = await prisma.patientBalance.findMany({
    where: { practiceId, treatmentDate: { gte: ninetyDaysAgo } },
    select: { procedureCode: true },
  });
  const labFeeProcs = labFeeRows.filter((r) =>
    r.procedureCode ? LAB_FEE_PROC_PREFIX.test(r.procedureCode) : false
  ).length;
  const labFee: DimensionMetric = {
    id: 6,
    key: 'lab_fee_margin',
    name: 'Lab fee margin (April 2026 schedule)',
    value: labFeeProcs,
    unit: 'count',
    status: labFeeProcs === 0 ? 'ok' : 'watch',
    detail: `${labFeeProcs} lab-driven procedure(s) tracked in last 90 days`,
  };

  // 7. Sedation utilization — count of nitrous-oxide procedures in past 90 days
  const sedationCount = await prisma.patientBalance.count({
    where: {
      practiceId,
      procedureCode: { in: [...NITROUS_OXIDE_CODES] },
      treatmentDate: { gte: ninetyDaysAgo },
    },
  });
  const sedation: DimensionMetric = {
    id: 7,
    key: 'sedation_utilization',
    name: 'Sedation sessions vs CDCP preauth threshold',
    value: sedationCount,
    unit: 'count',
    status: sedationCount < 4 ? 'ok' : sedationCount < 8 ? 'watch' : 'risk',
    detail:
      sedationCount < 4
        ? 'Below 4-session preauth threshold'
        : `${sedationCount} session(s) — preauth required for 5th+ on CDCP`,
  };

  // 8. COB / wraparound efficiency — ratio of paid to total balances older than 30 days
  const balances = await prisma.patientBalance.findMany({
    where: {
      practiceId,
      treatmentDate: { lt: new Date(now.getTime() - 30 * 86_400_000), not: null },
    },
    select: { paymentStatus: true },
  });
  const paid = balances.filter((b) => b.paymentStatus === 'paid').length;
  const cobValue = asPct(paid, balances.length);
  const cobEfficiency: DimensionMetric = {
    id: 8,
    key: 'cob_efficiency',
    name: 'COB / wraparound efficiency',
    value: cobValue,
    unit: 'pct',
    status:
      cobValue == null ? 'watch' : cobValue >= 70 ? 'ok' : cobValue >= 40 ? 'watch' : 'risk',
    detail: `${paid}/${balances.length} balances paid past 30-day mark`,
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
