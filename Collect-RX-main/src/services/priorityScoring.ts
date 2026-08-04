// ─────────────────────────────────────────────────────────────────────────────
// Pure priority-scoring math, shared by the server (priorityEngine.ts) and the
// client (lib/workQueuePriority.ts). No Node-only or Prisma-runtime imports —
// this module must stay safe to bundle into the browser build.
// ─────────────────────────────────────────────────────────────────────────────

import type { CarrierId, ClaimPriority, ClaimStatus, Prisma } from '@prisma/client';

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

/**
 * Practice-facing floor: large aging balances never display below High in the work queue.
 * `minNormalizedScore` aligns with `workQueuePriority.ts` THRESHOLDS.high (0.6).
 */
export const PRACTICE_PRIORITY_FLOOR = {
  minDollars: 2000,
  minDays: 45,
  minNormalizedScore: 0.6,
} as const;

export function applyPracticePriorityFloor(
  normalizedScore: number,
  dollarsOutstanding: number,
  daysOutstanding: number,
): number {
  if (
    dollarsOutstanding >= PRACTICE_PRIORITY_FLOOR.minDollars &&
    daysOutstanding >= PRACTICE_PRIORITY_FLOOR.minDays
  ) {
    return Math.max(normalizedScore, PRACTICE_PRIORITY_FLOOR.minNormalizedScore);
  }
  return normalizedScore;
}

/**
 * Normalize raw `scoreClaim().total` to 0–1 for work-queue display thresholds.
 *
 * Single source of truth for work-item `rankScore`: `scoreClaim` → ratio vs practice max
 * → `applyPracticePriorityFloor`. Call-queue scheduling uses the same engine via
 * `buildPriorityQueue` / `syncCallQueueSchedulingFromPriority` (raw totals + `scoreToClaimPriority`).
 */
export function normalizeClaimRankScore(
  totalScore: number,
  practiceMaxScore: number,
  dollarsOutstanding: number,
  daysOutstanding: number,
): number {
  const max = Math.max(practiceMaxScore, 1);
  const ratio = Math.max(0, totalScore / max);
  return Math.min(1, applyPracticePriorityFloor(ratio, dollarsOutstanding, daysOutstanding));
}

/** Score one claim for the work queue (0–1), consistent with `buildPriorityQueue`. */
export function rankClaimForPractice(
  input: PriorityScoreInput,
  practiceMaxScore: number,
): number {
  const { total } = scoreClaim(input);
  return normalizeClaimRankScore(
    total,
    practiceMaxScore,
    input.amountCents / 100,
    input.daysOutstanding,
  );
}

/** Claim row shape shared by work-queue sync and priority queue builders. */
export interface ClaimForPriorityScoring {
  carrierId: CarrierId;
  outstandingAmount: number | Prisma.Decimal;
  daysOutstanding: number;
  status: ClaimStatus;
  servicedAt: Date | null;
  queueEntry?: { attempts: number } | null;
  callAttempts?: { outcomeDetail: string | null }[];
}

export function buildPriorityScoreInput(
  claim: ClaimForPriorityScoring,
  referenceDate: Date = new Date(),
): PriorityScoreInput {
  const amountCents = Math.round(Number(claim.outstandingAmount) * 100);
  const attemptCount = claim.queueEntry?.attempts ?? claim.callAttempts?.length ?? 0;
  const lastDetail = claim.callAttempts?.[0]?.outcomeDetail ?? null;
  const approvedButUnpaid = inferApprovedButUnpaidLegacy(claim.status, amountCents, lastDetail);
  const serviceDate =
    claim.servicedAt != null
      ? new Date(claim.servicedAt)
      : estimateServiceDateFromOutstanding(referenceDate, claim.daysOutstanding);

  return {
    carrierId: claim.carrierId,
    amountCents,
    daysOutstanding: claim.daysOutstanding,
    attemptCount,
    referenceDate,
    serviceDate,
    claimStatus: claim.status,
    approvedButUnpaid,
  };
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

const CLAIM_PRIORITY_ORDINAL: Record<ClaimPriority, number> = {
  URGENT: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
};

/** Ordinal for sorting `ClaimPriority` bands most-urgent-first (lower = more urgent). */
export function claimPriorityOrdinal(priority: ClaimPriority): number {
  return CLAIM_PRIORITY_ORDINAL[priority];
}

// ─── Carrier call-order preference (CarrierPriorityPanel / `CarrierOrder` model) ──────────────
//
// The settings panel persists a practice's preferred carrier-calling sequence as a JSON string
// array on `CarrierOrder.order`. This shares the parsing + carrier-code normalization so both
// the settings API (`routes/queue.ts`) and dispatch ranking (`buildPriorityQueue`) agree.

/**
 * Parses a persisted `CarrierOrder.order` JSON string back into a string array, falling back to
 * `fallback` (a copy) when the value is missing, not JSON, or not an array of strings.
 */
export function parseCarrierOrderJson(raw: string, fallback: readonly string[]): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
      return parsed as string[];
    }
  } catch {
    /* ignore — falls through to fallback */
  }
  return [...fallback];
}

/** Display-code default order shown by `CarrierPriorityPanel` before a practice customizes it. */
export const DEFAULT_CARRIER_ORDER = [
  'sun_life',
  'canada_life',
  'manulife',
  'green_shield',
  'rbc_insurance',
  'telus_adjudicare',
] as const;

/**
 * `CarrierOrder.order` has always used the settings-panel display code `rbc_insurance`, while
 * `InsuranceClaim.carrierId` (the Prisma `CarrierId` enum) uses `rbc`. Normalize here so a saved
 * order actually lines up with real claim rows instead of silently matching nothing for RBC.
 */
const CARRIER_ORDER_CODE_ALIASES: Readonly<Record<string, CarrierId>> = {
  rbc_insurance: 'rbc',
};

const KNOWN_CARRIER_IDS: ReadonlySet<CarrierId> = new Set<CarrierId>([
  'sun_life',
  'canada_life',
  'manulife',
  'green_shield',
  'rbc',
  'telus_adjudicare',
]);

function normalizeCarrierOrderCode(code: string): CarrierId | null {
  const candidate = CARRIER_ORDER_CODE_ALIASES[code] ?? code;
  return KNOWN_CARRIER_IDS.has(candidate as CarrierId) ? (candidate as CarrierId) : null;
}

/**
 * Maps each recognized carrier to its position in a saved `CarrierOrder.order` list (first
 * occurrence wins; unrecognized/duplicate codes are skipped).
 */
export function buildCarrierOrderRankMap(order: readonly string[]): Map<CarrierId, number> {
  const map = new Map<CarrierId, number>();
  for (const code of order) {
    const id = normalizeCarrierOrderCode(code);
    if (id && !map.has(id)) map.set(id, map.size);
  }
  return map;
}

/** Rank of a carrier within a saved order; carriers absent from the saved list sort last. */
export function carrierOrderRank(carrierId: CarrierId, rankMap: ReadonlyMap<CarrierId, number>): number {
  return rankMap.get(carrierId) ?? rankMap.size;
}
