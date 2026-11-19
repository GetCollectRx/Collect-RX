/**
 * Autonomous calling graduation, per carrier (ADR 0005).
 *
 * ADR 0003 made Hold Sentinel the entry product and left one item open: the
 * evidence a carrier must show before CollectRx may speak with that carrier's
 * reps itself. This module is that rule.
 *
 * A carrier graduates when the staff-handled calls Claims_Scribe has logged
 * for it (HumanAssistedCallLog) show the conversation is predictable enough to
 * automate, AND the founder has approved it by name. The evidence makes a
 * carrier eligible; the approval makes it live. Neither alone is enough.
 *
 * PHI: everything here is a count. No log row content is read, so the
 * cross-practice query runs with RLS bypass and returns aggregates only.
 */
import type { CarrierId, PrismaClient } from '@prisma/client';
import { runWithRlsBypass } from '../db/rlsContext.js';

export interface GraduationCriteria {
  /** Staff-handled calls logged for the carrier inside the lookback window. */
  minStaffHandledCalls: number;
  /** Share of those calls where a reference number was captured. */
  minReferenceCaptureRate: number;
  /** Maximum share of calls that ended with fields the scribe could not fill. */
  maxUnresolvedRate: number;
  /** Maximum share of calls where the rep showed suspicion of automation. */
  maxAutomationSuspicionRate: number;
  /** Distinct playbook categories with at least one synthesized profile entry. */
  minProfileCategoriesCovered: number;
  /** Only calls newer than this count, so stale behaviour does not graduate a carrier. */
  lookbackDays: number;
}

/**
 * Starting thresholds. They are deliberately strict: a wrong autonomous call
 * costs carrier goodwill that a missed automation opportunity does not.
 * Tune them here; every change belongs in ADR 0005's change log.
 */
export const DEFAULT_GRADUATION_CRITERIA: GraduationCriteria = {
  minStaffHandledCalls: 50,
  minReferenceCaptureRate: 0.9,
  maxUnresolvedRate: 0.15,
  maxAutomationSuspicionRate: 0.02,
  minProfileCategoriesCovered: 3,
  lookbackDays: 90,
};

export interface CarrierGraduationStats {
  staffHandledCalls: number;
  referenceCaptured: number;
  unresolved: number;
  automationSuspicion: number;
  profileCategoriesCovered: number;
}

export type GraduationCheck =
  | 'sample_size'
  | 'reference_capture'
  | 'unresolved_rate'
  | 'automation_suspicion'
  | 'playbook_coverage';

export interface GraduationResult {
  carrierId: CarrierId;
  /** Evidence thresholds all pass. */
  eligible: boolean;
  /** Founder has approved this carrier by name (AUTONOMOUS_APPROVED_CARRIERS). */
  approved: boolean;
  /** eligible AND approved: autonomous calls may run for this carrier. */
  graduated: boolean;
  failedChecks: GraduationCheck[];
  stats: CarrierGraduationStats;
  rates: {
    referenceCaptureRate: number;
    unresolvedRate: number;
    automationSuspicionRate: number;
  };
}

function rate(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

/** Pure evaluation: stats in, verdict out. No I/O, so it is fully testable. */
export function evaluateGraduation(
  carrierId: CarrierId,
  stats: CarrierGraduationStats,
  approved: boolean,
  criteria: GraduationCriteria = DEFAULT_GRADUATION_CRITERIA,
): GraduationResult {
  const referenceCaptureRate = rate(stats.referenceCaptured, stats.staffHandledCalls);
  const unresolvedRate = rate(stats.unresolved, stats.staffHandledCalls);
  const automationSuspicionRate = rate(stats.automationSuspicion, stats.staffHandledCalls);

  const failedChecks: GraduationCheck[] = [];
  if (stats.staffHandledCalls < criteria.minStaffHandledCalls) failedChecks.push('sample_size');
  if (referenceCaptureRate < criteria.minReferenceCaptureRate) failedChecks.push('reference_capture');
  if (unresolvedRate > criteria.maxUnresolvedRate) failedChecks.push('unresolved_rate');
  if (automationSuspicionRate > criteria.maxAutomationSuspicionRate) failedChecks.push('automation_suspicion');
  if (stats.profileCategoriesCovered < criteria.minProfileCategoriesCovered) failedChecks.push('playbook_coverage');

  const eligible = failedChecks.length === 0;
  return {
    carrierId,
    eligible,
    approved,
    graduated: eligible && approved,
    failedChecks,
    stats,
    rates: { referenceCaptureRate, unresolvedRate, automationSuspicionRate },
  };
}

/**
 * Carriers the founder has approved for autonomous calling, from the
 * comma-separated AUTONOMOUS_APPROVED_CARRIERS env var. Unknown names are
 * ignored. Empty or unset means none.
 */
export function approvedCarriers(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.AUTONOMOUS_APPROVED_CARRIERS ?? '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Aggregate a carrier's evidence. Counts only; no row content leaves the database. */
export async function loadCarrierGraduationStats(
  prisma: PrismaClient,
  carrierId: CarrierId,
  criteria: GraduationCriteria = DEFAULT_GRADUATION_CRITERIA,
  now: Date = new Date(),
): Promise<CarrierGraduationStats> {
  const since = new Date(now.getTime() - criteria.lookbackDays * 24 * 60 * 60 * 1000);
  const window = { carrierId, createdAt: { gte: since } };

  return runWithRlsBypass(async () => {
    const [staffHandledCalls, referenceCaptured, unresolved, automationSuspicion, categories] =
      await Promise.all([
        prisma.humanAssistedCallLog.count({ where: window }),
        prisma.humanAssistedCallLog.count({
          where: { ...window, referenceNumber: { not: null }, NOT: { referenceNumber: '' } },
        }),
        prisma.humanAssistedCallLog.count({
          where: { ...window, unresolvedFields: { not: null }, NOT: { unresolvedFields: '' } },
        }),
        prisma.humanAssistedCallLog.count({ where: { ...window, automationSuspicionFlag: true } }),
        prisma.humanAssistedCarrierProfile.groupBy({ by: ['category'], where: { carrierId } }),
      ]);
    return {
      staffHandledCalls,
      referenceCaptured,
      unresolved,
      automationSuspicion,
      profileCategoriesCovered: categories.length,
    };
  });
}

export async function getCarrierGraduation(
  prisma: PrismaClient,
  carrierId: CarrierId,
  options: { criteria?: GraduationCriteria; env?: NodeJS.ProcessEnv; now?: Date } = {},
): Promise<GraduationResult> {
  const criteria = options.criteria ?? DEFAULT_GRADUATION_CRITERIA;
  const stats = await loadCarrierGraduationStats(prisma, carrierId, criteria, options.now);
  const approved = approvedCarriers(options.env).has(carrierId);
  return evaluateGraduation(carrierId, stats, approved, criteria);
}

// ---------------------------------------------------------------------------
// Dispatch-time lookup with a short cache. Graduation changes over days, not
// seconds, so the queue engine should not run five counts per dial.
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<CarrierId, { graduated: boolean; at: number }>();

/**
 * True only when the carrier is graduated. Fails closed: any error means the
 * call stays on Hold Sentinel.
 */
export async function isCarrierGraduated(prisma: PrismaClient, carrierId: CarrierId): Promise<boolean> {
  if (!approvedCarriers().has(carrierId)) return false; // cheap exit, no query
  const hit = cache.get(carrierId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.graduated;
  try {
    const result = await getCarrierGraduation(prisma, carrierId);
    cache.set(carrierId, { graduated: result.graduated, at: Date.now() });
    return result.graduated;
  } catch {
    return false;
  }
}

/** Test hook. */
export function clearGraduationCache(): void {
  cache.clear();
}
