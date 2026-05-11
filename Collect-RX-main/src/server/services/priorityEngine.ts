// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Priority scoring for the call queue (multi-factor, configurable).
//
// Analytics `/api/analytics/priority-balances` is unchanged; this module feeds
// queue ordering and workers via `buildPriorityQueue`.
//
// `InsuranceClaim.servicedAt` is the canonical appeal-clock anchor when set;
// otherwise `referenceDate − daysOutstanding` is used (documented fallback).
// ─────────────────────────────────────────────────────────────────────────────

import type { CarrierId, ClaimPriority, ClaimStatus, PrismaClient } from '@prisma/client';
import { CARRIER_CONFIGS } from '../../carriers/adapter';
import { piiVault } from '../../pii-vault';

/** Months from service date to carrier submission / appeal deadline (product rules). */
export const CARRIER_APPEAL_WINDOW_MONTHS: Record<CarrierId, number> = {
  sun_life: 12,
  manulife: 12,
  canada_life: 12,
  green_shield: 15,
  rbc: 12,
  telus_adjudicare: 24,
};

const DAY_MS = 86_400_000;

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

/** Inputs for pure scoring (tests + programmatic use). */
export interface PriorityScoreInput {
  carrierId: CarrierId;
  amountCents: number;
  daysOutstanding: number;
  attemptCount: number;
  /** Calendar anchor for “today” and for deadline math (inject in tests). */
  referenceDate: Date;
  /**
   * Service date anchors the appeal clock. When unknown, callers pass
   * `estimateServiceDateFromOutstanding(referenceDate, daysOutstanding)`.
   */
  serviceDate: Date;
  claimStatus: ClaimStatus;
  /**
   * When true, claim is treated as carrier-approved but payment not yet received (+100).
   * Usually inferred in `buildPriorityQueue` from the latest call attempt text.
   */
  approvedButUnpaid?: boolean;
}

export function estimateServiceDateFromOutstanding(
  referenceDate: Date,
  daysOutstanding: number,
): Date {
  const d = new Date(referenceDate);
  d.setUTCDate(d.getUTCDate() - Math.max(0, daysOutstanding));
  return d;
}

export function addCalendarMonths(d: Date, months: number): Date {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + months);
  return x;
}

/** Piecewise age score: 1× (0–30), 2× (31–60), 3× (61+). */
export function computeAgeScore(daysOutstanding: number): number {
  const d = Math.max(0, Math.floor(daysOutstanding));
  if (d <= 30) return d * 1;
  if (d <= 60) return 30 * 1 + (d - 30) * 2;
  return 30 * 1 + 30 * 2 + (d - 60) * 3;
}

/** Log-scaled dollar contribution (spec: Math.log10(amountCents / 100) × 100). */
export function computeAmountScore(amountCents: number): number {
  const dollars = Math.max(amountCents, 1) / 100;
  return Math.log10(dollars) * 100;
}

export function computeDeadlineMultiplier(deadlineDaysRemaining: number): 1 | 3 | 5 {
  const dr = Math.floor(deadlineDaysRemaining);
  if (dr <= 30) return 5;
  if (dr <= 60) return 3;
  return 1;
}

export function computeDeadlineDaysRemaining(
  serviceDate: Date,
  carrierId: CarrierId,
  referenceDate: Date,
): number {
  const months = CARRIER_APPEAL_WINDOW_MONTHS[carrierId];
  const deadline = addCalendarMonths(serviceDate, months);
  return Math.floor((deadline.getTime() - referenceDate.getTime()) / DAY_MS);
}

export function computeAttemptModifier(attemptCount: number): number {
  if (attemptCount === 0) return 50;
  if (attemptCount >= 3) return -30;
  return 0;
}

/**
 * Detect “approved / adjudicated but not yet paid” from a single call summary line.
 *
 * Pilot: regex on `outcomeDetail` / transcript-derived text — acceptable short-term, but
 * brittle across carrier phrasing. Before scale: drive this from **structured** fields on the
 * Vapi webhook payload (or a post-call LLM JSON schema), not free-text parsing.
 *
 * Prefer persisting `APPROVED_PENDING_PAYMENT` on the claim once detected (see Vapi webhook).
 * This helper remains for legacy rows, tests, and until structured outcomes ship.
 */
export function isApprovedPendingPaymentFromCallDetail(
  detail: string | null | undefined,
  outstandingCents: number,
): boolean {
  if (outstandingCents <= 0 || !detail) return false;
  const d = detail.toLowerCase();
  const soundsApproved = /\b(approved|adjudicated|accepted)\b/i.test(d);
  const soundsPaid =
    /payment\s+(was|has\s+been)|\b(paid|eft)\b.*\b(sent|issued|mailed)|cheque.*(sent|mailed|issued)/i.test(
      d,
    );
  return soundsApproved && !soundsPaid;
}

/**
 * Status modifier: `APPROVED_PENDING_PAYMENT` (+100), `DENIED` (−50), optional legacy
 * `approvedButUnpaid` when the enum has not been set yet.
 */
export function computeStatusModifier(
  claimStatus: ClaimStatus,
  approvedButUnpaid?: boolean,
): number {
  if (claimStatus === 'DENIED') return -50;
  if (claimStatus === 'APPROVED_PENDING_PAYMENT') return 100;
  if (approvedButUnpaid) return 100;
  return 0;
}

/**
 * Legacy text-based hint for scoring only — ignored when status is already
 * `APPROVED_PENDING_PAYMENT`, `RESOLVED`, or `DENIED`.
 */
export function inferApprovedButUnpaidLegacy(
  claimStatus: ClaimStatus,
  outstandingCents: number,
  lastAttemptDetail: string | null | undefined,
): boolean {
  if (
    claimStatus === 'DENIED' ||
    claimStatus === 'RESOLVED' ||
    claimStatus === 'APPROVED_PENDING_PAYMENT' ||
    outstandingCents <= 0
  ) {
    return false;
  }
  return isApprovedPendingPaymentFromCallDetail(lastAttemptDetail, outstandingCents);
}

/** @deprecated Use `inferApprovedButUnpaidLegacy` — kept for existing imports. */
export function inferApprovedButUnpaid(
  claimStatus: ClaimStatus,
  outstandingCents: number,
  lastAttemptDetail: string | null | undefined,
): boolean {
  return inferApprovedButUnpaidLegacy(claimStatus, outstandingCents, lastAttemptDetail);
}

export interface ScoredParts {
  age: number;
  amount: number;
  attempts: number;
  status: number;
  deadlineDaysRemaining: number;
  deadlineMultiplier: 1 | 3 | 5;
  deadlineScore: number;
  total: number;
}

/**
 * Full score: `(age + amount + attempts + status) * deadlineMultiplier`
 * with `deadlineScore` = extra points from multiplier (`base * (m - 1)`).
 */
export function scoreClaim(input: PriorityScoreInput): ScoredParts {
  const age = computeAgeScore(input.daysOutstanding);
  const amount = computeAmountScore(input.amountCents);
  const attempts = computeAttemptModifier(input.attemptCount);
  const status = computeStatusModifier(input.claimStatus, input.approvedButUnpaid);

  const deadlineDaysRemaining = computeDeadlineDaysRemaining(
    input.serviceDate,
    input.carrierId,
    input.referenceDate,
  );
  const deadlineMultiplier = computeDeadlineMultiplier(deadlineDaysRemaining);
  const base = age + amount + attempts + status;
  const deadlineScore = base * (deadlineMultiplier - 1);
  const total = base * deadlineMultiplier;

  return {
    age,
    amount,
    attempts,
    status,
    deadlineDaysRemaining,
    deadlineMultiplier,
    deadlineScore,
    total,
  };
}

function displayPatientName(patientToken: string): string {
  const r = piiVault.detokenize(patientToken, 'priority-queue');
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
): Promise<RankedClaim[]> {
  const claims = await prisma.insuranceClaim.findMany({
    where: {
      practiceId,
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
    const amountCents = Math.round(Number(c.outstandingAmount) * 100);
    const attemptCount = c.queueEntry?.attempts ?? c.callAttempts.length;
    const lastDetail = c.callAttempts[0]?.outcomeDetail ?? null;
    const approvedButUnpaidLegacy = inferApprovedButUnpaidLegacy(c.status, amountCents, lastDetail);

    const serviceDate =
      c.servicedAt != null
        ? new Date(c.servicedAt)
        : estimateServiceDateFromOutstanding(referenceDate, c.daysOutstanding);

    const parts = scoreClaim({
      carrierId: c.carrierId,
      amountCents,
      daysOutstanding: c.daysOutstanding,
      attemptCount,
      referenceDate,
      serviceDate,
      claimStatus: c.status,
      approvedButUnpaid: approvedButUnpaidLegacy,
    });

    const carrierName = CARRIER_CONFIGS[c.carrierId]?.displayName ?? c.carrierId;

    ranked.push({
      claimId: c.id,
      patientName: displayPatientName(c.patientToken),
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

  ranked.sort((a, b) => b.scores.total - a.scores.total);
  return ranked;
}

/** Map relative score into Prisma `ClaimPriority` for queue ordering + UI. */
export function scoreToClaimPriority(total: number, maxScore: number): ClaimPriority {
  if (!Number.isFinite(total) || maxScore <= 0) return 'NORMAL';
  const ratio = total / maxScore;
  if (ratio >= 0.9) return 'URGENT';
  if (ratio >= 0.65) return 'HIGH';
  if (ratio >= 0.35) return 'NORMAL';
  return 'LOW';
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
            where: { status: 'PENDING' },
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
      where: { practiceId: pid, status: 'PENDING' },
      select: { id: true, claimId: true },
    });
    if (pending.length === 0) continue;

    pending.sort((a, b) => {
      const ra = rankByClaimId.has(a.claimId) ? rankByClaimId.get(a.claimId)! : Number.MAX_SAFE_INTEGER;
      const rb = rankByClaimId.has(b.claimId) ? rankByClaimId.get(b.claimId)! : Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return a.claimId.localeCompare(b.claimId);
    });

    const totals = pending.map((p) => scoreByClaimId.get(p.claimId) ?? 0);
    const maxScore = Math.max(...totals, 1);

    const baseMs = referenceDate.getTime();
    const updates = pending.map((row, i) =>
      prisma.callQueue.update({
        where: { id: row.id },
        data: {
          scheduledFor: new Date(baseMs + i * slotMs),
          priority: scoreToClaimPriority(scoreByClaimId.get(row.claimId) ?? 0, maxScore),
        },
      }),
    );

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
  buildPriorityQueue,
  inferApprovedButUnpaid,
  inferApprovedButUnpaidLegacy,
  isApprovedPendingPaymentFromCallDetail,
  syncCallQueueSchedulingFromPriority,
  scoreToClaimPriority,
};
