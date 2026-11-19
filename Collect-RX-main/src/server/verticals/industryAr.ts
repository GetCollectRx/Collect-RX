/**
 * Accounts-receivable view of non-dental claims (auto collision, property
 * restoration, paramedical/physio, DME, roofing/trades, NEMT).
 *
 * Non-dental claims enter through POST /api/insurance/claims/upload and are
 * stored with carrierId 'other'. Until now nothing read them back: they never
 * reached a queue, a dashboard or an analytics query. This module turns them
 * into a payer-grouped summary and a prioritised worklist.
 *
 * PHI: only non-identifying columns are selected. The patient/insured token
 * and the primary/secondary references (which hold PIIVault tokens for VIN,
 * policy number, patient id and MRN) are never read here, so they cannot leak
 * into a response.
 *
 * Age is computed from the date of service at read time. The stored
 * daysOutstanding is frozen at import (non-dental claims are not re-synced),
 * so it goes stale by a day every day.
 */
import type { IndustryType, PrismaClient } from '@prisma/client';
import { computeAgeScore, computeAmountScore } from '../../services/priorityScoring.js';
import { normalizePayerKey, pickPayerDisplayName } from './payerNormalization.js';

const DAY_MS = 86_400_000;

export const AGING_BUCKETS = ['0-29', '30-59', '60-89', '90-119', '120+'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

/**
 * Why no non-dental claim can be dialled yet: no payer has a verified claims
 * line or IVR configuration, and the Vapi client refuses carrierId 'other'.
 */
export const NOT_DIALABLE_REASON = 'NO_VERIFIED_PAYER_LINE' as const;

export interface OpenIndustryClaim {
  id: string;
  claimNumber: string;
  industryType: IndustryType;
  payerName: string | null;
  /** Decimal string with 2 places, as stored. */
  outstandingAmount: string;
  servicedAt: Date | null;
  daysOutstanding: number;
  status: string;
}

export interface BucketTotals {
  claims: number;
  balanceCents: number;
}

export interface PayerSummary {
  payerKey: string;
  payerName: string;
  industries: IndustryType[];
  claims: number;
  balanceCents: number;
  oldestAgeDays: number;
  buckets: Record<AgingBucket, BucketTotals>;
}

export interface IndustrySummary {
  industryType: IndustryType;
  claims: number;
  balanceCents: number;
  buckets: Record<AgingBucket, BucketTotals>;
}

export interface IndustryArSummary {
  asOf: string;
  totals: BucketTotals;
  buckets: Record<AgingBucket, BucketTotals>;
  byIndustry: IndustrySummary[];
  byPayer: PayerSummary[];
  statusCounts: Record<string, number>;
  dialable: false;
  notDialableReason: typeof NOT_DIALABLE_REASON;
}

export interface IndustryWorklistItem {
  claimId: string;
  claimNumber: string;
  industryType: IndustryType;
  payerKey: string;
  payerName: string;
  ageDays: number;
  agingBucket: AgingBucket;
  balanceCents: number;
  status: string;
  priorityScore: number;
  dialable: false;
  notDialableReason: typeof NOT_DIALABLE_REASON;
}

export interface WorklistFilter {
  industryType?: IndustryType;
  payerKey?: string;
  limit?: number;
}

export const WORKLIST_DEFAULT_LIMIT = 50;
export const WORKLIST_MAX_LIMIT = 200;

/** "1234.5" / "1234.50" / "-3" to integer cents, without floating point. */
export function decimalStringToCents(value: string): number {
  const match = /^(-?)(\d+)(?:\.(\d{1,2})\d*)?$/u.exec(value.trim());
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  const whole = Number(match[2]);
  const fraction = Number((match[3] ?? '').padEnd(2, '0'));
  return sign * (whole * 100 + fraction);
}

export function liveAgeDays(claim: Pick<OpenIndustryClaim, 'servicedAt' | 'daysOutstanding'>, now: Date): number {
  if (claim.servicedAt) {
    return Math.max(0, Math.floor((now.getTime() - claim.servicedAt.getTime()) / DAY_MS));
  }
  return Math.max(0, claim.daysOutstanding);
}

export function agingBucket(ageDays: number): AgingBucket {
  if (ageDays < 30) return '0-29';
  if (ageDays < 60) return '30-59';
  if (ageDays < 90) return '60-89';
  if (ageDays < 120) return '90-119';
  return '120+';
}

function emptyBuckets(): Record<AgingBucket, BucketTotals> {
  return {
    '0-29': { claims: 0, balanceCents: 0 },
    '30-59': { claims: 0, balanceCents: 0 },
    '60-89': { claims: 0, balanceCents: 0 },
    '90-119': { claims: 0, balanceCents: 0 },
    '120+': { claims: 0, balanceCents: 0 },
  };
}

function add(totals: BucketTotals, cents: number): void {
  totals.claims += 1;
  totals.balanceCents += cents;
}

/** Open, non-deleted non-dental claims with a balance, for one practice. */
export async function loadOpenIndustryClaims(prisma: PrismaClient, practiceId: string): Promise<OpenIndustryClaim[]> {
  const rows = await prisma.insuranceClaim.findMany({
    where: {
      practiceId,
      deletedAt: null,
      industryType: { not: 'DENTAL' },
      status: { not: 'RESOLVED' },
      outstandingAmount: { gt: 0 },
    },
    select: {
      id: true,
      claimNumber: true,
      industryType: true,
      payerName: true,
      outstandingAmount: true,
      servicedAt: true,
      daysOutstanding: true,
      status: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    claimNumber: r.claimNumber,
    industryType: r.industryType,
    payerName: r.payerName,
    outstandingAmount: r.outstandingAmount.toString(),
    servicedAt: r.servicedAt,
    daysOutstanding: r.daysOutstanding,
    status: r.status,
  }));
}

function payerNames(claims: ReadonlyArray<OpenIndustryClaim>): Map<string, string> {
  const spellings = new Map<string, string[]>();
  for (const c of claims) {
    const key = normalizePayerKey(c.payerName);
    const list = spellings.get(key) ?? [];
    if (c.payerName) list.push(c.payerName);
    spellings.set(key, list);
  }
  return new Map([...spellings.entries()].map(([key, names]) => [key, pickPayerDisplayName(names)]));
}

export function summarizeIndustryAr(claims: ReadonlyArray<OpenIndustryClaim>, now: Date): IndustryArSummary {
  const totals: BucketTotals = { claims: 0, balanceCents: 0 };
  const buckets = emptyBuckets();
  const byIndustry = new Map<IndustryType, IndustrySummary>();
  const byPayer = new Map<string, PayerSummary>();
  const statusCounts: Record<string, number> = {};
  const names = payerNames(claims);

  for (const c of claims) {
    const cents = decimalStringToCents(c.outstandingAmount);
    const age = liveAgeDays(c, now);
    const bucket = agingBucket(age);
    add(totals, cents);
    add(buckets[bucket], cents);
    statusCounts[c.status] = (statusCounts[c.status] ?? 0) + 1;

    const industry = byIndustry.get(c.industryType) ?? {
      industryType: c.industryType,
      claims: 0,
      balanceCents: 0,
      buckets: emptyBuckets(),
    };
    industry.claims += 1;
    industry.balanceCents += cents;
    add(industry.buckets[bucket], cents);
    byIndustry.set(c.industryType, industry);

    const payerKey = normalizePayerKey(c.payerName);
    const payer = byPayer.get(payerKey) ?? {
      payerKey,
      payerName: names.get(payerKey) ?? 'Unknown payer',
      industries: [],
      claims: 0,
      balanceCents: 0,
      oldestAgeDays: 0,
      buckets: emptyBuckets(),
    };
    payer.claims += 1;
    payer.balanceCents += cents;
    payer.oldestAgeDays = Math.max(payer.oldestAgeDays, age);
    if (!payer.industries.includes(c.industryType)) payer.industries.push(c.industryType);
    add(payer.buckets[bucket], cents);
    byPayer.set(payerKey, payer);
  }

  return {
    asOf: now.toISOString(),
    totals,
    buckets,
    byIndustry: [...byIndustry.values()].sort((a, b) => b.balanceCents - a.balanceCents),
    byPayer: [...byPayer.values()]
      .map((p) => ({ ...p, industries: [...p.industries].sort() }))
      .sort((a, b) => b.balanceCents - a.balanceCents || a.payerKey.localeCompare(b.payerKey)),
    statusCounts,
    dialable: false,
    notDialableReason: NOT_DIALABLE_REASON,
  };
}

/**
 * Highest-value work first, using the same age and amount scores the dental
 * queue uses. Non-dental payers have no product-defined appeal window yet, so
 * no deadline multiplier is applied.
 */
export function buildIndustryWorklist(
  claims: ReadonlyArray<OpenIndustryClaim>,
  now: Date,
  filter: WorklistFilter = {},
): IndustryWorklistItem[] {
  const names = payerNames(claims);
  const limit = Math.min(Math.max(1, Math.floor(filter.limit ?? WORKLIST_DEFAULT_LIMIT)), WORKLIST_MAX_LIMIT);
  return claims
    .filter((c) => !filter.industryType || c.industryType === filter.industryType)
    .map((c) => {
      const payerKey = normalizePayerKey(c.payerName);
      const ageDays = liveAgeDays(c, now);
      const balanceCents = decimalStringToCents(c.outstandingAmount);
      return {
        claimId: c.id,
        claimNumber: c.claimNumber,
        industryType: c.industryType,
        payerKey,
        payerName: names.get(payerKey) ?? 'Unknown payer',
        ageDays,
        agingBucket: agingBucket(ageDays),
        balanceCents,
        status: c.status,
        priorityScore: Math.round(computeAgeScore(ageDays) + computeAmountScore(balanceCents)),
        dialable: false as const,
        notDialableReason: NOT_DIALABLE_REASON,
      };
    })
    .filter((item) => !filter.payerKey || item.payerKey === filter.payerKey)
    .sort((a, b) => b.priorityScore - a.priorityScore || b.balanceCents - a.balanceCents || a.claimNumber.localeCompare(b.claimNumber))
    .slice(0, limit);
}
