import type { PrismaClient, RecoveryRoute } from '@prisma/client';
import { checkRecoveryDispatchGate } from './dispatchGate.js';
import {
  getPracticeRecoveryMode,
  paymentConfirmationHint,
  paymentConfirmationLabel,
} from './recoveryMode.js';

const ROUTE_LABELS: Record<RecoveryRoute, string> = {
  CALL_CARRIER: 'Call carrier',
  WAIT_SYNC: 'Await PMS payment confirmation',
  OPEN_CDCP: 'CDCP reconsideration',
  PRACTICE_GATE: 'Practice action required',
  STOP: 'Closed — no further carrier calls',
};

const ROUTE_DESCRIPTIONS: Record<RecoveryRoute, string> = {
  CALL_CARRIER:
    'CollectRx will re-call the carrier when the scheduled time arrives and dispatch rules allow.',
  WAIT_SYNC:
    'Carrier reported payment. The loop closes when AbelDent sync shows the outstanding balance drop — not from call status alone.',
  OPEN_CDCP:
    'This is a CDCP denial path. Gather evidence and submit reconsideration — generic carrier calls are paused.',
  PRACTICE_GATE:
    'Staff must complete the listed action before CollectRx places another carrier call.',
  STOP: 'Automated carrier follow-up is complete for this claim.',
};

export interface ClaimRecoveryActionView {
  id: string;
  actionType: string;
  status: string;
  title: string;
  detail: string | null;
  scheduledRecallAt: string | null;
  createdAt: string;
  blocking: boolean;
}

export interface ClaimRecoveryEventView {
  id: string;
  eventType: string;
  amountRecoveredCents: number | null;
  previousOutstanding: number | null;
  newOutstanding: number | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

export interface ClaimRecoverySummary {
  claimId: string;
  claimNumber: string;
  claimStatus: string;
  recoveryRoute: RecoveryRoute | null;
  routeLabel: string;
  routeDescription: string;
  outstandingAmount: number;
  paymentExpectedBy: string | null;
  scheduledRecallAt: string | null;
  queueStatus: string | null;
  queueAttempts: number;
  stopCalling: boolean;
  canCallCarrier: boolean;
  dispatchBlockReason: string | null;
  openActions: ClaimRecoveryActionView[];
  recentEvents: ClaimRecoveryEventView[];
  dollarsRecoveredSyncVerified: number;
  cdcpCaseId: string | null;
  cdcpCaseStatus: string | null;
}

export async function getClaimRecoverySummary(
  prisma: PrismaClient,
  practiceId: string,
  claimId: string,
): Promise<ClaimRecoverySummary | null> {
  const claim = await prisma.insuranceClaim.findFirst({
    where: { id: claimId, practiceId },
    include: {
      queueEntry: true,
      recoveryActions: {
        where: { clearedAt: null },
        orderBy: { createdAt: 'desc' },
      },
      recoveryEvents: {
        orderBy: { createdAt: 'desc' },
        take: 8,
      },
    },
  });
  if (!claim) return null;

  const recoveryMode = await getPracticeRecoveryMode(prisma, practiceId);
  const dispatch = await checkRecoveryDispatchGate(prisma, claimId);

  const route = claim.recoveryRoute;
  const stopCalling =
    route === 'STOP' ||
    route === 'WAIT_SYNC' ||
    route === 'OPEN_CDCP' ||
    claim.status === 'ON_HOLD' ||
    claim.status === 'RESOLVED' ||
    claim.status === 'DENIED' ||
    claim.status === 'BLOCKED';

  const scheduledRecallAt =
    claim.queueEntry?.scheduledFor ??
    claim.recoveryActions.find((a) => a.scheduledRecallAt)?.scheduledRecallAt ??
    null;

  const verifiedEvents = await prisma.claimRecoveryEvent.findMany({
    where: { claimId, eventType: { in: ['PAYMENT_VERIFIED_SYNC', 'MANUAL_PAYMENT_CONFIRMED'] } },
    select: { amountRecoveredCents: true },
  });
  const dollarsRecoveredSyncVerified =
    verifiedEvents.reduce((s, e) => s + (e.amountRecoveredCents ?? 0), 0) / 100;

  const cdcpAction = claim.recoveryActions.find((a) => a.cdcpCaseId);
  const cdcpCase = cdcpAction?.cdcpCaseId
    ? await prisma.cdcpReconsiderationCase.findUnique({
        where: { id: cdcpAction.cdcpCaseId },
        select: { id: true, status: true },
      })
    : await prisma.cdcpReconsiderationCase.findFirst({
        where: { practiceId, claimRef: claim.claimNumber },
        select: { id: true, status: true },
      });

  return {
    claimId: claim.id,
    claimNumber: claim.claimNumber,
    claimStatus: claim.status,
    recoveryRoute: route,
    routeLabel:
      route === 'WAIT_SYNC'
        ? paymentConfirmationLabel(recoveryMode)
        : route
          ? ROUTE_LABELS[route]
          : 'Not routed yet',
    routeDescription:
      route === 'WAIT_SYNC'
        ? paymentConfirmationHint(recoveryMode)
        : route
          ? ROUTE_DESCRIPTIONS[route]
          : ROUTE_DESCRIPTIONS.CALL_CARRIER,
    outstandingAmount: Number(claim.outstandingAmount),
    paymentExpectedBy: claim.paymentExpectedBy?.toISOString() ?? null,
    scheduledRecallAt: scheduledRecallAt?.toISOString() ?? null,
    queueStatus: claim.queueEntry?.status ?? null,
    queueAttempts: claim.queueEntry?.attempts ?? 0,
    stopCalling,
    canCallCarrier: dispatch.allowed,
    dispatchBlockReason: dispatch.allowed ? null : dispatch.reason ?? null,
    openActions: claim.recoveryActions.map((a) => ({
      id: a.id,
      actionType: a.actionType,
      status: a.status,
      title: a.title,
      detail: a.detail,
      scheduledRecallAt: a.scheduledRecallAt?.toISOString() ?? null,
      createdAt: a.createdAt.toISOString(),
      blocking: a.status === 'BLOCKING',
    })),
    recentEvents: claim.recoveryEvents.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      amountRecoveredCents: e.amountRecoveredCents,
      previousOutstanding: e.previousOutstanding != null ? Number(e.previousOutstanding) : null,
      newOutstanding: e.newOutstanding != null ? Number(e.newOutstanding) : null,
      createdAt: e.createdAt.toISOString(),
      metadata: (e.metadata as Record<string, unknown>) ?? null,
    })),
    dollarsRecoveredSyncVerified,
    cdcpCaseId: cdcpCase?.id ?? null,
    cdcpCaseStatus: cdcpCase?.status ?? null,
  };
}
