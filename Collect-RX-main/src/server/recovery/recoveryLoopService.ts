import type { PrismaClient } from '@prisma/client';
import type { ProcessedOutcome } from '../../outcome/processor.js';
import { enqueueEmrClaimEvent } from '../emrSyncOutbox.js';
import {
  ensureCdcpCaseForClaim,
  linkRecoveryActionToCdcpCase,
} from './cdcpRecoveryBridge.js';
import { claimStatusFromCallOutcome } from '../claimStatusFromCallOutcome.js';
import { hasFinancialCorroboration } from '../outcomeConfidence.js';
import {
  routeClaimRecovery,
  routeForPaymentTraceRecall,
} from './claimRouter.js';
import { shouldSupersedeBlockingGate, shouldSupersedeOpenAction, isPracticeGateHoldDecision } from './gateSupersession.js';
import type { RecoveryDecision } from './types.js';

export interface ApplyRecoveryAfterCallParams {
  claim: {
    id: string;
    practiceId: string;
    carrierId: string;
    claimNumber: string;
    patientToken: string;
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

async function hasOpenCdcpCase(
  prisma: PrismaClient,
  practiceId: string,
  claimRef: string,
): Promise<boolean> {
  const row = await prisma.cdcpReconsiderationCase.findFirst({
    where: { practiceId, claimRef, status: { notIn: ['approved', 'denied_final', 'expired'] } },
    select: { id: true },
  });
  return Boolean(row);
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
): Promise<void> {
  await supersedeRecoveryActions(prisma, claim.id, decision, outcomeDetail);

  if (!decision.recoveryActionType || !decision.actionTitle) return;

  await prisma.claimRecoveryAction.create({
    data: {
      practiceId: claim.practiceId,
      claimId: claim.id,
      actionType: decision.recoveryActionType,
      status: decision.route === 'PRACTICE_GATE' ? 'BLOCKING' : 'OPEN',
      route: decision.route,
      title: decision.actionTitle,
      detail: decision.actionDetail,
      scheduledRecallAt: decision.scheduledRecallAt,
      callAttemptId: attemptId,
      metadata: { reason: decision.reason },
    },
  });
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

  const [blockingGate, cdcpOpen] = await Promise.all([
    hasBlockingPracticeGate(prisma, claim.id),
    hasOpenCdcpCase(prisma, claim.practiceId, claim.claimNumber),
  ]);

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
  });

  let cdcpCaseId: string | undefined;
  if (decision.openCdcpCase && claim.carrierId === 'sun_life') {
    const cdcp = await ensureCdcpCaseForClaim(prisma, {
      practiceId: claim.practiceId,
      patientToken: claim.patientToken,
      claimRef: claim.claimNumber,
      clinicalSummary: processed.outcomeDetail,
    });
    if (cdcp) cdcpCaseId = cdcp.caseId;
  }

  await prisma.$transaction(async (tx) => {
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
    await persistRecoveryAction(tx as unknown as PrismaClient, claim, attemptId, decision, processed.outcomeDetail);

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
  });

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
    console.error('[recoveryLoop] EMR outbox enqueue failed (non-fatal):', e);
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

  const lockedIds = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM claim_recovery_actions
    WHERE action_type = 'PAYMENT_VERIFY_SYNC'
      AND status = 'OPEN'
      AND scheduled_recall_at <= ${now}
      AND cleared_at IS NULL
    ORDER BY scheduled_recall_at ASC
    LIMIT 50
    FOR UPDATE SKIP LOCKED
  `;

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
