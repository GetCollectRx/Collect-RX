/**
 * Ontario dual-coverage A/R aging sweep.
 *
 * Three ticks over CDCP claims (InsuranceClaim.payerType === 'CDCP'),
 * mirroring the shape of the existing generic aging machinery
 * (overdueActionEscalation.ts, dataRetentionJob.ts) rather than a new
 * ad-hoc queue table — this reuses ClaimRecoveryAction, CobRoute,
 * escalationService, practiceNotificationService, and emrSyncOutbox, all of
 * which already exist for exactly this shape of work.
 *
 * Day-30 deviation from the literal PRD: the source PRD frames this as a
 * generic "day 30 since submission" bucket. That is the wrong anchor for a
 * COB secondary filing deadline — you cannot file a secondary claim before
 * the primary has been adjudicated, since the secondary amount depends on
 * the primary's EOB. sweepAccertaCobRouting instead fires as soon as a CDCP
 * claim with a provincial secondary is adjudicated (RESOLVED /
 * APPROVED_PENDING_PAYMENT), which starts the 30-day Accerta window with the
 * maximum head start rather than eating into it. See CobRoute's own comment
 * in schema.prisma for the same reasoning.
 */

import type { PrismaClient } from '@prisma/client';
import { createEscalation } from '../services/escalationService.js';
import { sendPracticeNotification } from '../services/practiceNotificationService.js';
import { enqueueEmrClaimEvent } from '../emrSyncOutbox.js';
import { ACCERTA_SECONDARY_FILING_WINDOW_DAYS, ACCERTA_SECONDARY_CARRIER_NAME } from '../services/billing/ontarioCdcpConfig.js';
import { logger } from '../observability/logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY15_PORTAL_CHECK_MIN_DAYS = 15;
const DAY45_ESCALATION_DAYS = 45;

function daysSince(date: Date, asOf: Date): number {
  return Math.floor((asOf.getTime() - date.getTime()) / DAY_MS);
}

/**
 * Day 15: for CDCP claims still sitting in PENDING (imported/submitted, no
 * carrier response yet — see prismaClaimImporter.ts's create default), open
 * a PAYMENT_VERIFY_SYNC recovery action to trigger a portal status check.
 * Reuses the existing recovery-action type rather than adding a new enum
 * value — "verify via sync/portal" is the same operational shape whether the
 * trigger is a generic aging rule or this CDCP-specific one.
 */
export async function sweepCdcpPortalVerification(
  prisma: PrismaClient,
  asOf: Date = new Date(),
): Promise<number> {
  const candidates = await prisma.insuranceClaim.findMany({
    where: {
      payerType: 'CDCP',
      status: 'PENDING',
      deletedAt: null,
      submittedAt: { not: null, lte: new Date(asOf.getTime() - DAY15_PORTAL_CHECK_MIN_DAYS * DAY_MS) },
      recoveryActions: {
        none: { actionType: 'PAYMENT_VERIFY_SYNC', clearedAt: null },
      },
    },
    select: { id: true, practiceId: true, claimNumber: true },
    take: 200,
  });

  let opened = 0;
  for (const claim of candidates) {
    try {
      await prisma.claimRecoveryAction.create({
        data: {
          practiceId: claim.practiceId,
          claimId: claim.id,
          actionType: 'PAYMENT_VERIFY_SYNC',
          status: 'OPEN',
          route: 'WAIT_SYNC',
          title: 'CDCP portal status check due (15 days since submission)',
          detail: `Claim ${claim.claimNumber}: no carrier response after ${DAY15_PORTAL_CHECK_MIN_DAYS} days. Verify status via the Sun Life CDCP provider portal.`,
        },
      });
      opened += 1;
    } catch (err) {
      logger.error('[ontario-ar-sweep] Day 15 portal-check action failed', { claimId: claim.id, error: err });
    }
  }
  return opened;
}

/**
 * On CDCP adjudication (not a fixed day-30 clock — see module comment):
 * for claims whose patient has an active provincial secondary (Accerta),
 * create the CobRoute and queue the secondary submission to beat the
 * statutory filing window.
 */
export async function sweepAccertaCobRouting(
  prisma: PrismaClient,
  asOf: Date = new Date(),
): Promise<number> {
  const candidates = await prisma.insuranceClaim.findMany({
    where: {
      payerType: 'CDCP',
      status: { in: ['RESOLVED', 'APPROVED_PENDING_PAYMENT'] },
      deletedAt: null,
      resolvedAt: { not: null },
      cobRoute: null,
    },
    select: { id: true, practiceId: true, claimNumber: true, patientToken: true, resolvedAt: true },
    take: 200,
  });

  let routed = 0;
  for (const claim of candidates) {
    if (!claim.resolvedAt) continue;
    try {
      const coverage = await prisma.cdcpCoverage.findUnique({
        where: { patientToken: claim.patientToken },
        select: { hasProvincialSecondary: true },
      });
      if (!coverage?.hasProvincialSecondary) continue;

      const secondaryFilingDeadline = new Date(
        claim.resolvedAt.getTime() + ACCERTA_SECONDARY_FILING_WINDOW_DAYS * DAY_MS,
      );

      await prisma.cobRoute.create({
        data: {
          claimId: claim.id,
          secondaryPayerType: 'PROVINCIAL',
          secondaryCarrierName: ACCERTA_SECONDARY_CARRIER_NAME,
          secondaryFilingDeadline,
          autoSubmitted: true,
          submittedAt: asOf,
        },
      });

      await prisma.claimSubmission.create({
        data: {
          practiceId: claim.practiceId,
          claimId: claim.id,
          method: 'accerta_cob_auto',
          note: `Secondary COB claim auto-queued for Accerta. Filing deadline: ${secondaryFilingDeadline.toISOString().slice(0, 10)}.`,
        },
      });

      routed += 1;
    } catch (err) {
      logger.error('[ontario-ar-sweep] Accerta COB routing failed', { claimId: claim.id, error: err });
    }
  }
  return routed;
}

/**
 * Day 45 (from Accerta submission): if the secondary still hasn't resolved,
 * escalate to a human and push the unpaid balance back to the practice's
 * PMS ledger (emrSyncOutbox — a no-op for CSV-first practices; see
 * enqueueEmrClaimEvent).
 */
export async function sweepAccertaCobEscalation(
  prisma: PrismaClient,
  asOf: Date = new Date(),
): Promise<number> {
  const overdue = await prisma.cobRoute.findMany({
    where: {
      autoSubmitted: true,
      escalatedAt: null,
      submittedAt: { not: null, lte: new Date(asOf.getTime() - DAY45_ESCALATION_DAYS * DAY_MS) },
    },
    include: {
      claim: {
        select: { id: true, practiceId: true, claimNumber: true, carrierId: true, outstandingAmount: true },
      },
    },
    take: 200,
  });

  let escalated = 0;
  for (const route of overdue) {
    try {
      await createEscalation(prisma, {
        practiceId: route.claim.practiceId,
        claimId: route.claim.id,
        claimRef: route.claim.claimNumber,
        carrierId: route.claim.carrierId,
        amountClaimedCents: Math.round(Number(route.claim.outstandingAmount) * 100),
        reason: `Accerta secondary COB submission for claim ${route.claim.claimNumber} has not resolved ${DAY45_ESCALATION_DAYS} days after filing. Escalating for human follow-up.`,
      });

      try {
        await sendPracticeNotification(prisma, {
          practiceId: route.claim.practiceId,
          type: 'ACTION_OVERDUE',
          subject: `Claim ${route.claim.claimNumber}: Accerta secondary unpaid`,
          message: `The Accerta secondary COB claim filed on ${route.submittedAt?.toISOString().slice(0, 10)} has not resolved after ${DAY45_ESCALATION_DAYS} days. Escalated for human follow-up.`,
          claimId: route.claim.id,
          severity: 'warning',
        });
      } catch (notifErr) {
        logger.error('[ontario-ar-sweep] Day 45 notification failed (non-fatal)', { error: notifErr });
      }

      await enqueueEmrClaimEvent(prisma, {
        practiceId: route.claim.practiceId,
        claimId: route.claim.id,
        eventType: 'ONTARIO_ACCERTA_UNPAID_ESCALATION',
        payload: {
          outstandingAmount: Number(route.claim.outstandingAmount),
          secondaryCarrierName: route.secondaryCarrierName,
          daysOverdue: route.submittedAt ? daysSince(route.submittedAt, asOf) : null,
        },
      });

      await prisma.cobRoute.update({ where: { id: route.id }, data: { escalatedAt: asOf } });
      escalated += 1;
    } catch (err) {
      logger.error('[ontario-ar-sweep] Day 45 escalation failed', { cobRouteId: route.id, error: err });
    }
  }
  return escalated;
}

export interface OntarioArAgingSweepResult {
  portalChecksOpened: number;
  cobRoutesCreated: number;
  cobEscalations: number;
}

export async function runOntarioArAgingSweep(
  prisma: PrismaClient,
  asOf: Date = new Date(),
): Promise<OntarioArAgingSweepResult> {
  const portalChecksOpened = await sweepCdcpPortalVerification(prisma, asOf);
  const cobRoutesCreated = await sweepAccertaCobRouting(prisma, asOf);
  const cobEscalations = await sweepAccertaCobEscalation(prisma, asOf);

  if (portalChecksOpened > 0 || cobRoutesCreated > 0 || cobEscalations > 0) {
    logger.info('[ontario-ar-sweep] tick complete', { portalChecksOpened, cobRoutesCreated, cobEscalations });
  }

  return { portalChecksOpened, cobRoutesCreated, cobEscalations };
}
