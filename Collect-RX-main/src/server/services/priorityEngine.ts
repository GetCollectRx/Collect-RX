// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Priority scoring for the call queue (multi-factor, configurable).
//
// Analytics `/api/analytics/priority-balances` is unchanged; this module feeds
// queue ordering and workers via `buildPriorityQueue`.
//
// `InsuranceClaim.servicedAt` is the canonical appeal-clock anchor when set;
// otherwise `referenceDate − daysOutstanding` is used (documented fallback).
// ─────────────────────────────────────────────────────────────────────────────

import type { CarrierId, PrismaClient } from '@prisma/client';
import { CARRIER_CONFIGS } from '../../carriers/adapter';
import { piiVault } from '../../pii-vault';
import { appendPhiAccessEvent } from '../audit/auditLog';
import {
  applyPracticePriorityFloor,
  buildCarrierOrderRankMap,
  buildPriorityScoreInput,
  CARRIER_APPEAL_WINDOW_MONTHS,
  carrierOrderRank,
  claimPriorityOrdinal,
  DEFAULT_CARRIER_ORDER,
  estimateServiceDateFromOutstanding,
  inferApprovedButUnpaid,
  inferApprovedButUnpaidLegacy,
  isApprovedPendingPaymentFromCallDetail,
  normalizeClaimRankScore,
  parseCarrierOrderJson,
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

function displayPatientName(
  prisma: PrismaClient,
  patientToken: string,
  practiceId: string,
  claimId: string,
): string {
  const r = piiVault.detokenize(patientToken, 'priority-queue', { practiceId });
  if (!r.success || !r.phi?.patientName?.trim()) {
    return `Patient ${patientToken.slice(0, 8)}…`;
  }
  // Fire-and-forget: buildPriorityQueue runs per-claim in a hot loop (dashboard
  // loads, queue ticks) — logging must not add a sequential DB round trip per
  // claim. appendPhiAccessEvent already swallows its own errors (non-fatal).
  void appendPhiAccessEvent(prisma, {
    practiceId,
    operation: 'detokenize_for_display',
    recordType: 'InsuranceClaim',
    recordId: claimId,
    purpose: 'priority_queue_display',
  });
  return r.phi.patientName.trim();
}

/**
 * Returns open claims for the practice, ranked by priority score (highest first).
 *
 * Age/amount/deadline/attempts/status (`scoreClaim`) remain the sole determinant of which
 * `ClaimPriority` band (URGENT/HIGH/NORMAL/LOW) a claim falls into — that ordering is never
 * overridden. When the practice has saved a carrier call-order preference (`CarrierOrder`,
 * set via the CarrierPriorityPanel settings UI), it is consulted only as a *tiebreaker within
 * the same band*, so claims sequence by the practice's preferred carrier order without a
 * lower-urgency claim ever jumping ahead of a higher-urgency one.
 */
export async function buildPriorityQueue(
  prisma: PrismaClient,
  practiceId: string,
  referenceDate: Date = new Date(),
): Promise<RankedClaim[]> {
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

  const scored: { claim: RankedClaim; carrierId: CarrierId }[] = [];

  for (const c of claims) {
    const parts = scoreClaim(buildPriorityScoreInput(c, referenceDate));
    const amountCents = Math.round(Number(c.outstandingAmount) * 100);
    const attemptCount = c.queueEntry?.attempts ?? c.callAttempts?.length ?? 0;

    const carrierName = CARRIER_CONFIGS[c.carrierId]?.displayName ?? c.carrierId;

    scored.push({
      carrierId: c.carrierId,
      claim: {
        claimId: c.id,
        patientName: displayPatientName(prisma, c.patientToken, practiceId, c.id),
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
      },
    });
  }

  if (scored.length > 1) {
    const carrierOrderRow = await prisma.carrierOrder.findUnique({ where: { practiceId } });
    if (carrierOrderRow) {
      const rankMap = buildCarrierOrderRankMap(
        parseCarrierOrderJson(carrierOrderRow.order, DEFAULT_CARRIER_ORDER),
      );
      const maxScore = Math.max(...scored.map((s) => s.claim.scores.total), 1);

      scored.sort((a, b) => {
        const tierDelta =
          claimPriorityOrdinal(scoreToClaimPriority(a.claim.scores.total, maxScore)) -
          claimPriorityOrdinal(scoreToClaimPriority(b.claim.scores.total, maxScore));
        if (tierDelta !== 0) return tierDelta;

        const carrierDelta = carrierOrderRank(a.carrierId, rankMap) - carrierOrderRank(b.carrierId, rankMap);
        if (carrierDelta !== 0) return carrierDelta;

        return b.claim.scores.total - a.claim.scores.total;
      });
      return scored.map((s) => s.claim);
    }
  }

  scored.sort((a, b) => b.claim.scores.total - a.claim.scores.total);
  return scored.map((s) => s.claim);
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
    const ranked = await buildPriorityQueue(prisma, pid, referenceDate);
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
