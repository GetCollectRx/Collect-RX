import type { PrismaClient } from '@prisma/client';
import type { ProcessedOutcome } from '../../outcome/processor.js';
import { enqueueEmrClaimEvent } from '../emrSyncOutbox.js';
import {
  ensureCdcpCaseForClaim,
  hasOpenCdcpCaseForClaim,
  linkRecoveryActionToCdcpCase,
  primaryProcedureFromTreatmentCodes,
} from './cdcpRecoveryBridge.js';
import { claimStatusFromCallOutcome } from '../claimStatusFromCallOutcome.js';
import { hasFinancialCorroboration } from '../outcomeConfidence.js';
import {
  routeClaimRecovery,
  routeForPaymentTraceRecall,
} from './claimRouter.js';
import { shouldSupersedeBlockingGate, shouldSupersedeOpenAction, isPracticeGateHoldDecision } from './gateSupersession.js';
import { getCarrierHoldStats } from './holdLedger.js';
import type { RecoveryDecision } from './types.js';
import { logger } from '../observability/logger.js';

export interface ApplyRecoveryAfterCallParams {
  claim: {
    id: string;
    practiceId: string;
    carrierId: string;
    claimNumber: string;
    patientToken: string;
    treatmentCodes?: string | null;
    outstandingAmount: { toString(): string } | number;
    daysOutstanding: number;
    status: import('@prisma/client').ClaimStatus;
  };
  attemptId: string;
  processed: ProcessedOutcome;
  structuredClaimStatus: import('@prisma/client').ClaimStatus | null;
  gatedClaimStatus: import('@prisma/client').ClaimStatus;
  proposedClaimStatus: import('@prisma/client').ClaimStatus;
  paymentCorroborated: boolean;
  completedAt: Date;
}

async function hasBlockingPracticeGate(prisma: PrismaClient, claimId: string): Promise<boolean> {
  const n = await prisma.claimRecoveryAction.count({
    where: {
      claimId,
      status: 'BLOCKING',
      actionType: { in: ['PRACTICE_RESUBMIT', 'PRACTICE_DOCS'] },
    },
  });
  return n > 0;
}

async function supersedeRecoveryActions(
  prisma: PrismaClient,
  claimId: string,
  decision: RecoveryDecision,
  outcomeDetail: string | null,
): Promise<void> {
  if (isPracticeGateHoldDecision(decision)) {
    return;
  }

  const openActions = await prisma.claimRecoveryAction.findMany({
    where: { claimId, status: 'OPEN', clearedAt: null },
    select: { id: true, actionType: true },
  });

  const now = new Date();
  for (const action of openActions) {
    if (shouldSupersedeOpenAction(action.actionType, decision)) {
      await prisma.claimRecoveryAction.update({
        where: { id: action.id },
        data: { status: 'CLEARED', clearedAt: now },
      });
    }
  }

  const blocking = await prisma.claimRecoveryAction.findMany({
    where: { claimId, status: 'BLOCKING', clearedAt: null },
    select: { id: true, actionType: true },
  });

  for (const action of blocking) {
    if (shouldSupersedeBlockingGate(action.actionType, decision, outcomeDetail)) {
      await prisma.claimRecoveryAction.update({
        where: { id: action.id },
        data: { status: 'CLEARED', clearedAt: now },
      });
    }
  }
}

async function persistRecoveryAction(
  prisma: PrismaClient,
  claim: ApplyRecoveryAfterCallParams['claim'],
  attemptId: string,
  decision: RecoveryDecision,
  outcomeDetail: string | null,
): Promise<{ id: string; blocking: boolean; title: string; detail: string | null } | null> {
  await supersedeRecoveryActions(prisma, claim.id, decision, outcomeDetail);

  if (!decision.recoveryActionType || !decision.actionTitle) return null;

  const blocking = decision.route === 'PRACTICE_GATE';
  const created = await prisma.claimRecoveryAction.create({
    data: {
      practiceId: claim.practiceId,
      claimId: claim.id,
      actionType: decision.recoveryActionType,
      status: blocking ? 'BLOCKING' : 'OPEN',
      route: decision.route,
      title: decision.actionTitle,
      detail: decision.actionDetail,
      scheduledRecallAt: decision.scheduledRecallAt,
      callAttemptId: attemptId,
      metadata: { reason: decision.reason },
    },
  });

  return {
    id: created.id,
    blocking,
    title: created.title,
    detail: created.detail,
  };
}

async function upsertCallQueue(
  prisma: PrismaClient,
  claimId: string,
  practiceId: string,
  decision: RecoveryDecision,
  attemptCount: number,
  lastAttemptAt: Date,
): Promise<void> {
  const scheduledFor = decision.scheduledRecallAt ?? new Date();
  const shouldIncrementAttempts =
    decision.route === 'CALL_CARRIER' &&
    decision.queueStatus === 'PENDING' &&
    !decision.stopCalling;

  await prisma.callQueue.upsert({
    where: { claimId },
    create: {
      practiceId,
      claimId,
      scheduledFor,
      priority: 'NORMAL',
      attempts: shouldIncrementAttempts ? attemptCount + 1 : attemptCount,
      lastAttemptAt,
      status: decision.queueStatus,
    },
    update: {
      scheduledFor,
      lastAttemptAt,
      status: decision.queueStatus,
      ...(shouldIncrementAttempts ? { attempts: { increment: 1 } } : {}),
    },
  });
}

export async function applyRecoveryAfterCall(
  prisma: PrismaClient,
  params: ApplyRecoveryAfterCallParams,
): Promise<RecoveryDecision> {
  const { claim, attemptId, processed, gatedClaimStatus, proposedClaimStatus } =
    params;

  const outstandingCents = Math.round(Number(claim.outstandingAmount) * 100);
  const queueEntry = await prisma.callQueue.findUnique({ where: { claimId: claim.id } });
  const attemptCount = queueEntry?.attempts ?? 0;

  const procedureCode = primaryProcedureFromTreatmentCodes(claim.treatmentCodes);

  const [blockingGate, cdcpOpen, priorEngagedAttempts, carrierHoldStats] = await Promise.all([
    hasBlockingPracticeGate(prisma, claim.id),
    hasOpenCdcpCaseForClaim(prisma, {
      practiceId: claim.practiceId,
      patientToken: claim.patientToken,
      claimRef: claim.claimNumber,
      procedureCode,
    }),
    prisma.callAttempt.count({
      where: {
        claimId: claim.id,
        OR: [{ referenceNumber: { not: null } }, { repName: { not: null } }],
      },
    }),
    getCarrierHoldStats(prisma, claim.practiceId, claim.carrierId),
  ]);

  const hasEngagementEvidence =
    Boolean(processed.referenceNumber) ||
    Boolean(processed.repName) ||
    priorEngagedAttempts > 0;

  const decision = routeClaimRecovery({
    callOutcome: processed.outcome,
    outcomeDetail: processed.outcomeDetail,
    gatedClaimStatus,
    proposedClaimStatus,
    outstandingCents,
    carrierId: claim.carrierId,
    daysOutstanding: claim.daysOutstanding,
    attemptCount,
    hasBlockingPracticeGate: blockingGate,
    hasOpenCdcpCase: cdcpOpen,
    paymentCorroborated: params.paymentCorroborated,
    hasEngagementEvidence,
    carrierHoldDumpRate: carrierHoldStats.dumpRate,
  });

  let cdcpCaseId: string | undefined;
  if (decision.openCdcpCase && claim.carrierId === 'sun_life') {
    const cdcp = await ensureCdcpCaseForClaim(prisma, {
      practiceId: claim.practiceId,
      patientToken: claim.patientToken,
      claimRef: claim.claimNumber,
      procedureCode,
      clinicalSummary: processed.outcomeDetail,
    });
    if (cdcp) cdcpCaseId = cdcp.caseId;
  }

  const gateToNotify = await prisma.$transaction(async (tx) => {
    await tx.insuranceClaim.update({
      where: { id: claim.id },
      data: {
        status: decision.claimStatus,
        recoveryRoute: decision.route,
        paymentExpectedBy: decision.paymentExpectedBy,
      },
    });

    await upsertCallQueue(
      tx as unknown as PrismaClient,
      claim.id,
      claim.practiceId,
      decision,
      attemptCount,
      params.completedAt,
    );
    const createdGate = await persistRecoveryAction(
      tx as unknown as PrismaClient,
      claim,
      attemptId,
      decision,
      processed.outcomeDetail,
    );

    await tx.claimRecoveryEvent.create({
      data: {
        practiceId: claim.practiceId,
        claimId: claim.id,
        eventType: 'ROUTE_ASSIGNED',
        metadata: {
          callAttemptId: attemptId,
          route: decision.route,
          reason: decision.reason,
          callOutcome: processed.outcome,
          claimStatus: decision.claimStatus,
          queueStatus: decision.queueStatus,
          scheduledRecallAt: decision.scheduledRecallAt?.toISOString() ?? null,
        },
      },
    });

    if (decision.claimStatus === 'ESCALATED') {
      const existing = await tx.callEscalation.findFirst({
        where: {
          claimId: claim.id,
          status: 'open',
          reason: decision.actionDetail ?? '',
        },
      });
      if (!existing) {
        await tx.callEscalation.create({
          data: {
            claimId: claim.id,
            claimRef: claim.claimNumber,
            practiceId: claim.practiceId,
            carrierId: claim.carrierId as import('@prisma/client').CarrierId,
            amountClaimedCents: Math.round(Number(claim.outstandingAmount) * 100),
            reason: decision.actionDetail ?? '',
            status: 'open',
          },
        });
      }
    }

    return createdGate;
  });

  if (gateToNotify?.blocking) {
    const { notifyPracticeOnBlockingGate } = await import('./recoveryNotifications.js');
    void notifyPracticeOnBlockingGate(prisma, {
      practiceId: claim.practiceId,
      gateId: gateToNotify.id,
      claimId: claim.id,
      claimNumber: claim.claimNumber,
      title: gateToNotify.title,
      detail: gateToNotify.detail,
    }).catch((e) => {
      logger.error('[recoveryLoop] gate alert failed (non-fatal)', { error: e });
    });
  }

  if (cdcpCaseId) {
    await linkRecoveryActionToCdcpCase(prisma, claim.id, cdcpCaseId);
  }

  return decision;
}

/** Resolve proposed status + corroboration from webhook fields. */
export function resolveGatedClaimStatus(
  processed: ProcessedOutcome,
  structuredClaimStatus: import('@prisma/client').ClaimStatus | null,
  outstandingCents: number,
): {
  proposedClaimStatus: import('@prisma/client').ClaimStatus;
  gatedClaimStatus: import('@prisma/client').ClaimStatus;
  paymentCorroborated: boolean;
} {
  const corroboration = {
    hasStructuredPayload: Boolean(structuredClaimStatus),
    referenceNumber: processed.referenceNumber,
  };
  const proposedClaimStatus =
    structuredClaimStatus ??
    claimStatusFromCallOutcome(
      processed.outcome,
      processed.outcomeDetail,
      outstandingCents,
      structuredClaimStatus,
    );
  const gatedClaimStatus = claimStatusFromCallOutcome(
    processed.outcome,
    processed.outcomeDetail,
    outstandingCents,
    structuredClaimStatus,
    corroboration,
  );
  const paymentCorroborated = hasFinancialCorroboration(corroboration);
  return { proposedClaimStatus, gatedClaimStatus, paymentCorroborated };
}

export async function emitRecoveryTerminalEmrEvent(
  prisma: PrismaClient,
  claim: { practiceId: string; id: string },
  claimStatus: import('@prisma/client').ClaimStatus,
  processed: ProcessedOutcome,
): Promise<void> {
  if (!['RESOLVED', 'DENIED', 'ESCALATED'].includes(claimStatus)) return;
  try {
    await enqueueEmrClaimEvent(prisma, {
      practiceId: claim.practiceId,
      claimId: claim.id,
      eventType: claimStatus === 'RESOLVED' ? 'PAYMENT_CONFIRMED' : 'CLAIM_STATUS_UPDATED',
      payload: {
        outcome: processed.outcome,
        outcomeDetail: processed.outcomeDetail,
        repName: processed.repName,
        referenceNumber: processed.referenceNumber,
        resolvedAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    logger.error('[recoveryLoop] EMR outbox enqueue failed (non-fatal)', { error: e });
  }
}

/** Rules-engine tick: payment trace recalls when sync never confirmed payment. */
export async function processPaymentTraceDue(prisma: PrismaClient): Promise<number> {
  const now = new Date();
  // M-6: compile-time guard — if RecoveryActionStatus enum is ever renamed,
  // this assignment will fail to compile, surfacing the broken raw SQL below.
  // Do not remove this line without updating the raw SQL string to match.
  const _openStatus: import('@prisma/client').RecoveryActionStatus = 'OPEN';
  void _openStatus; // used only for type-checking

  // Raw SQL never receives the RLS extension's set_config (it only wraps model
  // operations), so under FORCE RLS a bare $queryRaw silently returns zero rows.
  // This worker legitimately crosses tenants: set the bypass flag in the same
  // transaction as the query — set_config(..., true) is transaction-scoped.
  const lockedIds = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'true', true)`;
    return tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM claim_recovery_actions
      WHERE action_type = 'PAYMENT_VERIFY_SYNC'
        AND status = 'OPEN'
        AND scheduled_recall_at <= ${now}
        AND cleared_at IS NULL
      ORDER BY scheduled_recall_at ASC
      LIMIT 50
      FOR UPDATE SKIP LOCKED
    `;
  });

  if (lockedIds.length === 0) return 0;

  const due = await prisma.claimRecoveryAction.findMany({
    where: { id: { in: lockedIds.map((r) => r.id) } },
    include: {
      claim: {
        select: {
          id: true,
          practiceId: true,
          carrierId: true,
          claimNumber: true,
          outstandingAmount: true,
          daysOutstanding: true,
          status: true,
        },
      },
    },
  });

  let updated = 0;
  for (const action of due) {
    const c = action.claim;
    if (Number(c.outstandingAmount) <= 0) continue;
    if (!['RESOLVED', 'APPROVED_PENDING_PAYMENT'].includes(c.status)) continue;

    const decision = routeForPaymentTraceRecall(now);
    await prisma.$transaction([
      prisma.claimRecoveryAction.update({
        where: { id: action.id },
        data: { status: 'CLEARED', clearedAt: now },
      }),
      prisma.insuranceClaim.update({
        where: { id: c.id },
        data: { status: decision.claimStatus, recoveryRoute: decision.route },
      }),
      prisma.callQueue.upsert({
        where: { claimId: c.id },
        create: {
          practiceId: c.practiceId,
          claimId: c.id,
          scheduledFor: decision.scheduledRecallAt!,
          status: decision.queueStatus,
          attempts: 0,
          lastAttemptAt: now,
        },
        update: {
          scheduledFor: decision.scheduledRecallAt!,
          status: decision.queueStatus,
          lastAttemptAt: now,
        },
      }),
    ]);
    const traceAction = await prisma.claimRecoveryAction.create({
      data: {
        practiceId: c.practiceId,
        claimId: c.id,
        actionType: 'PAYMENT_TRACE',
        status: 'OPEN',
        route: decision.route,
        title: decision.actionTitle!,
        detail: decision.actionDetail,
        scheduledRecallAt: decision.scheduledRecallAt,
        metadata: { reason: decision.reason },
      },
    });
    await prisma.claimRecoveryEvent.create({
      data: {
        practiceId: c.practiceId,
        claimId: c.id,
        eventType: 'PAYMENT_TRACE_SCHEDULED',
        metadata: {
          actionId: traceAction.id,
          scheduledRecallAt: decision.scheduledRecallAt?.toISOString() ?? null,
          reason: decision.reason,
        },
      },
    });
    updated += 1;
  }
  return updated;
}

/** Clear a blocking practice gate and schedule follow-up call. */
export async function clearRecoveryGate(
  prisma: PrismaClient,
  params: { practiceId: string; claimId: string; actionId: string },
): Promise<{ scheduledRecallAt: Date | null }> {
  const { transitionClaimRecovery } = await import('./transitionClaimRecovery.js');
  const result = await transitionClaimRecovery(prisma, {
    practiceId: params.practiceId,
    claimId: params.claimId,
    kind: 'GATE_CLEARED',
    actionId: params.actionId,
  });
  return { scheduledRecallAt: result.scheduledRecallAt };
}
