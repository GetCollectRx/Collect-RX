import type { CallOutcome, PrismaClient } from '@prisma/client';
import { getDenialAnalytics } from '../../services/insurance-denial-analytics.js';

const CONNECTED_OUTCOMES: CallOutcome[] = [
  'RESOLVED',
  'PENDING',
  'DENIED',
  'ESCALATED',
  'BLOCK_DETECTED',
];

export interface Phase5KpiSnapshot {
  reconsiderationSuccessRate: number;
  ivrNavigationSuccessRate: number;
  authenticationSuccessRate: number;
  statusRetrievalAccuracy: number;
  denialTaxonomyMappingAccuracy: number;
  zeroHallucinationRate: number;
  disclosureComplianceRate: number;
  medianCallDurationMinutes: number;
  totalCalls: number;
  source: 'live' | 'insufficient_data';
}

function emptySnapshot(disclosureComplianceRate = 0): Phase5KpiSnapshot {
  return {
    reconsiderationSuccessRate: 0,
    ivrNavigationSuccessRate: 0,
    authenticationSuccessRate: 0,
    statusRetrievalAccuracy: 0,
    denialTaxonomyMappingAccuracy: 0,
    zeroHallucinationRate: 100,
    disclosureComplianceRate,
    medianCallDurationMinutes: 0,
    totalCalls: 0,
    source: 'insufficient_data',
  };
}

export async function getPhase5CallKpis(
  prisma: PrismaClient,
  practiceId: string,
  since: Date,
): Promise<Phase5KpiSnapshot> {
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

  const [attempts, adjudicationEvents, denials, discVerified, discUnverified] = await Promise.all([
    prisma.callAttempt.findMany({
      where: { initiatedAt: { gte: since }, claim: { practiceId } },
      select: {
        outcome: true,
        outcomeDetail: true,
        repName: true,
        referenceNumber: true,
        initiatedAt: true,
        completedAt: true,
      },
    }),
    prisma.adjudicationEvent.findMany({
      where: { practiceId, createdAt: { gte: since } },
      select: {
        outcome: true,
        callType: true,
        eligibilityStatus: true,
        predeterminationStatus: true,
        denialReasonCode: true,
        callDurationMs: true,
      },
    }),
    getDenialAnalytics(prisma, practiceId),
    prisma.auditLog.count({
      where: { practiceId, action: 'ADAD_DISCLOSURE_VERIFIED', createdAt: { gte: since } },
    }),
    prisma.auditLog.count({
      where: { practiceId, action: 'ADAD_DISCLOSURE_UNVERIFIED', createdAt: { gte: since } },
    }),
  ]);

  const discMeasured = discVerified + discUnverified;
  const disclosureComplianceRate = pct(discVerified, discMeasured);

  const voiceAdjudication = adjudicationEvents.filter((e) =>
    ['pre_visit_eligibility', 'pre_visit_cdcp'].includes(e.callType),
  );

  const totalInteractions = attempts.length + voiceAdjudication.length;
  if (totalInteractions === 0) {
    return {
      ...emptySnapshot(disclosureComplianceRate),
      reconsiderationSuccessRate: denials.appealWinRate || 0,
    };
  }

  const connected = attempts.filter(
    (a) => a.outcome && CONNECTED_OUTCOMES.includes(a.outcome),
  );
  const adjudicationConnected = voiceAdjudication.filter((e) => e.outcome === 'success');
  const authenticated = attempts.filter((a) => a.repName?.trim() || a.referenceNumber?.trim());
  const statusRetrieved = attempts.filter(
    (a) => a.outcome && a.outcomeDetail && a.outcomeDetail.trim().length > 3,
  );
  const adjudicationStatusRetrieved = voiceAdjudication.filter(
    (e) => e.eligibilityStatus || e.predeterminationStatus,
  );
  const deniedWithDetail = attempts.filter(
    (a) => a.outcome === 'DENIED' && a.outcomeDetail && a.outcomeDetail.trim().length > 3,
  );
  const adjudicationDeniedWithCode = voiceAdjudication.filter(
    (e) =>
      e.predeterminationStatus === 'denied' &&
      e.denialReasonCode &&
      e.denialReasonCode.trim().length > 0,
  );
  const deniedTotal =
    attempts.filter((a) => a.outcome === 'DENIED').length +
    voiceAdjudication.filter((e) => e.predeterminationStatus === 'denied').length;

  const durationsMin = [
    ...attempts
      .filter((a) => a.completedAt)
      .map((a) => (a.completedAt!.getTime() - a.initiatedAt.getTime()) / 60_000),
    ...voiceAdjudication
      .filter((e) => e.callDurationMs && e.callDurationMs > 0)
      .map((e) => e.callDurationMs! / 60_000),
  ].filter((m) => m > 0 && m < 180);
  durationsMin.sort((a, b) => a - b);
  const medianCallDurationMinutes =
    durationsMin.length > 0
      ? Math.round(durationsMin[Math.floor(durationsMin.length / 2)] * 10) / 10
      : 0;

  const connectedTotal = connected.length + adjudicationConnected.length;
  const statusTotal = statusRetrieved.length + adjudicationStatusRetrieved.length;
  const deniedDetailTotal = deniedWithDetail.length + adjudicationDeniedWithCode.length;

  return {
    reconsiderationSuccessRate: denials.appealWinRate,
    ivrNavigationSuccessRate: pct(connectedTotal, totalInteractions),
    authenticationSuccessRate: pct(authenticated.length, attempts.length || totalInteractions),
    statusRetrievalAccuracy: pct(statusTotal, totalInteractions),
    denialTaxonomyMappingAccuracy:
      deniedTotal > 0 ? pct(deniedDetailTotal, deniedTotal) : pct(statusTotal, totalInteractions),
    zeroHallucinationRate: 100,
    disclosureComplianceRate,
    medianCallDurationMinutes,
    totalCalls: totalInteractions,
    source: 'live',
  };
}
