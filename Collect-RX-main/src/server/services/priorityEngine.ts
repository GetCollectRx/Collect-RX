// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Priority scoring for the call queue (multi-factor, configurable).
//
// Analytics `/api/analytics/priority-balances` is unchanged; this module feeds
// queue ordering and workers via `buildPriorityQueue`.
//
// `InsuranceClaim.servicedAt` is the canonical appeal-clock anchor when set;
// otherwise `referenceDate − daysOutstanding` is used (documented fallback).
// ─────────────────────────────────────────────────────────────────────────────

import type { PrismaClient } from '@prisma/client';
import { CARRIER_CONFIGS } from '../../carriers/adapter';
import { piiVault } from '../../pii-vault';
import { appendPhiAccessEvent } from '../audit/auditLog';
import {
  applyPracticePriorityFloor,
  buildPriorityScoreInput,
  CARRIER_APPEAL_WINDOW_MONTHS,
  estimateServiceDateFromOutstanding,
  inferApprovedButUnpaid,
  inferApprovedButUnpaidLegacy,
  isApprovedPendingPaymentFromCallDetail,
  normalizeClaimRankScore,
  rankClaimForPractice,
  scoreClaim,
  scoreToClaimPriority,
} from '../../services/priorityScoring';

export * from '../../services/priorityScoring';

export interface RankedClaimScores {
  age: number;
  amount: number;
  deadline: number;
  attempts: number;
  status: number;
  total: number;
}

export interface RankedClaim {
  claimId: string;
  patientName: string;
  carrier: string;
  amountCents: number;
  daysOutstanding: number;
  attemptCount: number;
  deadlineDaysRemaining: number;
  scores: RankedClaimScores;
}

function displayPatientName(patientToken: string, practiceId: string): string {
  const r = piiVault.detokenize(patientToken, 'priority-queue', { practiceId });
  if (!r.success || !r.phi?.patientName?.trim()) {
    return `Patient ${patientToken.slice(0, 8)}…`;
  }
  return r.phi.patientName.trim();
}

/**
 * Returns open claims for the practice, ranked by priority score (highest first).
 */
export async function buildPriorityQueue(
  prisma: PrismaClient,
  practiceId: string,
  referenceDate: Date = new Date(),
  options: { resolvePatientNames?: boolean } = {},
): Promise<RankedClaim[]> {
  // Scheduling-only callers (syncCallQueueSchedulingFromPriority) never surface
  // patientName — skip detokenization entirely rather than doing it and
  // discarding the result, so PHI is only touched when a human will see it.
  const resolvePatientNames = options.resolvePatientNames ?? true;

  const claims = await prisma.insuranceClaim.findMany({
    where: {
      practiceId,
      deletedAt: null,
      status: { not: 'RESOLVED' },
    },
    include: {
      queueEntry: { select: { attempts: true } },
      callAttempts: {
        orderBy: { initiatedAt: 'desc' },
        take: 1,
        select: { outcomeDetail: true, outcome: true },
      },
    },
  });

  const ranked: RankedClaim[] = [];

  for (const c of claims) {
    const parts = scoreClaim(buildPriorityScoreInput(c, referenceDate));
    const amountCents = Math.round(Number(c.outstandingAmount) * 100);
    const attemptCount = c.queueEntry?.attempts ?? c.callAttempts?.length ?? 0;

    const carrierName = CARRIER_CONFIGS[c.carrierId]?.displayName ?? c.carrierId;

    ranked.push({
      claimId: c.id,
      patientName: resolvePatientNames
        ? displayPatientName(c.patientToken, practiceId)
        : `Patient ${c.patientToken.slice(0, 8)}…`,
      carrier: carrierName,
      amountCents,
      daysOutstanding: c.daysOutstanding,
      attemptCount,
      deadlineDaysRemaining: parts.deadlineDaysRemaining,
      scores: {
        age: parts.age,
        amount: parts.amount,
        deadline: parts.deadlineScore,
        attempts: parts.attempts,
        status: parts.status,
        total: parts.total,
      },
    });
  }

  if (resolvePatientNames && claims.length > 0) {
    // One audit row per queue view/build, not per claim — the access is a
    // single "resolve names for this practice's queue" operation.
    await appendPhiAccessEvent(prisma, {
      practiceId,
      operation: 'detokenize_for_priority_queue_display',
      recordType: 'PriorityQueue',
      recordId: practiceId,
      purpose: 'priority_queue_display',
      correlationId: `${claims.length}_claims`,
    });
  }

  ranked.sort((a, b) => b.scores.total - a.scores.total);
  return ranked;
}

export interface PrioritySyncResult {
  practices: number;
  rowsUpdated: number;
}

const DEFAULT_SLOT_MS = 60_000;

/**
 * Re-ranks pending `call_queue` rows using `buildPriorityQueue`, then persists
 * `scheduledFor` (staggered) and `priority` so `GET /api/insurance/queue` and
 * dispatch logic see engine order.
 *
 * @param practiceId — when set, only that practice; otherwise all practices that have pending queue rows.
 */
export async function syncCallQueueSchedulingFromPriority(
  prisma: PrismaClient,
  practiceId?: string | null,
  referenceDate: Date = new Date(),
): Promise<PrioritySyncResult> {
  const slotMs = Math.max(
    5_000,
    parseInt(process.env.PRIORITY_QUEUE_SLOT_MS ?? String(DEFAULT_SLOT_MS), 10) || DEFAULT_SLOT_MS,
  );

  const practiceIds: string[] =
    practiceId != null && String(practiceId).trim() !== ''
      ? [String(practiceId).trim()]
      : (
          await prisma.callQueue.findMany({
            where: { status: 'PENDING', claim: { deletedAt: null } },
            distinct: ['practiceId'],
            select: { practiceId: true },
          })
        ).map((r) => r.practiceId);

  let rowsUpdated = 0;

  for (const pid of practiceIds) {
    // Scheduling only needs claimId + score — never surfaces patientName —
    // so skip PHI detokenization entirely for this internal re-ranking pass.
    const ranked = await buildPriorityQueue(prisma, pid, referenceDate, {
      resolvePatientNames: false,
    });
    const rankByClaimId = new Map(ranked.map((r, i) => [r.claimId, i]));
    const scoreByClaimId = new Map(ranked.map((r) => [r.claimId, r.scores.total]));

    const pending = await prisma.callQueue.findMany({
      where: { practiceId: pid, status: 'PENDING', claim: { deletedAt: null } },
      select: { id: true, claimId: true, scheduledFor: true },
    });
    if (pending.length === 0) continue;

    const claimIds = pending.map((p) => p.claimId);
    const [claims, blockingActions] = await Promise.all([
      prisma.insuranceClaim.findMany({
        where: { id: { in: claimIds }, deletedAt: null },
        select: { id: true, recoveryRoute: true },
      }),
      prisma.claimRecoveryAction.findMany({
        where: { claimId: { in: claimIds }, status: 'BLOCKING', clearedAt: null },
        select: { claimId: true },
      }),
    ]);
    const routeByClaimId = new Map(claims.map((c) => [c.id, c.recoveryRoute]));
    const blockingClaimIds = new Set(blockingActions.map((b) => b.claimId));

    const schedulable = pending.filter((row) => {
      const route = routeByClaimId.get(row.claimId);
      if (route && route !== 'CALL_CARRIER') return false;
      if (blockingClaimIds.has(row.claimId)) return false;
      return true;
    });
    if (schedulable.length === 0) continue;

    schedulable.sort((a, b) => {
      const ra = rankByClaimId.has(a.claimId) ? rankByClaimId.get(a.claimId)! : Number.MAX_SAFE_INTEGER;
      const rb = rankByClaimId.has(b.claimId) ? rankByClaimId.get(b.claimId)! : Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return a.claimId.localeCompare(b.claimId);
    });

    const totals = schedulable.map((p) => scoreByClaimId.get(p.claimId) ?? 0);
    const maxScore = Math.max(...totals, 1);

    const { mergeRecoveryRecallWithPrioritySlot } = await import('./priorityScheduleMerge.js');

    const baseMs = referenceDate.getTime();
    const updates = schedulable.map((row, i) => {
      const prioritySlot = new Date(baseMs + i * slotMs);
      return prisma.callQueue.update({
        where: { id: row.id },
        data: {
          scheduledFor: mergeRecoveryRecallWithPrioritySlot(row.scheduledFor, prioritySlot),
          priority: scoreToClaimPriority(scoreByClaimId.get(row.claimId) ?? 0, maxScore),
        },
      });
    });

    const chunk = 40;
    for (let i = 0; i < updates.length; i += chunk) {
      await prisma.$transaction(updates.slice(i, i + chunk));
    }
    rowsUpdated += pending.length;
  }

  return { practices: practiceIds.length, rowsUpdated };
}

/** Namespace export for callers that prefer `PriorityEngine.buildPriorityQueue`. */
export const PriorityEngine = {
  CARRIER_APPEAL_WINDOW_MONTHS,
  estimateServiceDateFromOutstanding,
  scoreClaim,
  rankClaimForPractice,
  normalizeClaimRankScore,
  applyPracticePriorityFloor,
  buildPriorityScoreInput,
  buildPriorityQueue,
  inferApprovedButUnpaid,
  inferApprovedButUnpaidLegacy,
  isApprovedPendingPaymentFromCallDetail,
  syncCallQueueSchedulingFromPriority,
  scoreToClaimPriority,
};
