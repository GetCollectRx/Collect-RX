// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Carrier Adapter
//
// Per-carrier configuration for call routing, IVR wait times, and the
// CARRIER_BLOCK pre-dispatch check.
//
// CARRIER_BLOCK protocol: before dispatching ANY call, call
// `checkCarrierBlock(practiceId, carrierId)`. If it returns true, abort
// immediately — do not initiate the Vapi call under any circumstances.
//
// TELUS AdjudiCare: always run `identifyTelusTpa()` before routing.
// The underlying TPA determines IVR navigation — TELUS is a clearinghouse.
// ─────────────────────────────────────────────────────────────────────────────

import type { CarrierId, ClaimStatus, PrismaClient } from '@prisma/client';
import { CARRIER_PHONE_MAP } from '../vapi/client';
import { identifyTelusPlan } from '../services/eligibility/engine';
import { validateSubscriptionClaimCapacity } from '../server/stripe/subscriptionPlans.js';
import carrierRulesJson from '../services/eligibility/rules/carrier-configs.json';
import { CARRIER_CONCURRENCY_LIMITS, DEFAULT_CARRIER_CONCURRENCY_LIMIT } from '../billing/tiers.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CarrierConfig {
  carrierId: CarrierId;
  displayName: string;
  /** Direct-dial number for claims department */
  phone: string;
  /** Minimum days outstanding before calling — day 21 for TELUS, day 32 others */
  minWaitDays: number;
  /** Expected hold time in minutes (for analytics time-saved calc) */
  avgHoldMinutes: number;
  /** Whether this carrier is a clearinghouse (requires TPA identification) */
  isClearinghouse: boolean;
  /** IVR navigation hints for IVR_Navigator agent */
  ivrHints: string[];
  /**
   * Maximum age (days) of a claim that can still be electronically submitted/corrected.
   * Sun Life updated to 365 days (electronic) effective 2026.
   */
  maxRecoverableAgeDays?: number;
  /**
   * Display alias used by IVR_Navigator and Claims_Agent in voice interactions.
   * When set, agents use this name instead of displayName (e.g. Beneva vs La Capitale).
   */
  ivrAlias?: string;
  /**
   * CDAnet Transaction 23 (PreDetermination EOB) support.
   * When true, the system can request an instant electronic adjudication bypass
   * via Tx23 rather than initiating a full IVR call for status.
   */
  supportsTransaction23?: boolean;
  /**
   * When true, the CallQueue must attempt a portal-based status check
   * (e.g. providerConnect) before dispatching a Vapi voice call.
   */
  portalFirstDispatch?: boolean;
}

export interface DispatchGuard {
  allowed: boolean;
  code?: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Per-carrier configuration
//
// Carrier rules are data, not code: dispatch behavior (wait days, hold times,
// IVR hints) lives in rules/carrier-configs.json so mid-pilot carrier tweaks
// need no deploy. This module only assembles the typed view of that data.
// ---------------------------------------------------------------------------

interface CarrierDispatchRules {
  displayName: string;
  avgHoldMinutes: number;
  ivrHints: string[];
  maxRecoverableAgeDays?: number;
  ivrAlias?: string;
  supportsTransaction23?: boolean;
  portalFirstDispatch?: boolean;
}

interface CarrierRulesEntry {
  isClearinghouse: boolean;
  minWaitDayForClaims: number;
  dispatch: CarrierDispatchRules;
}

function buildCarrierConfigs(): Record<CarrierId, CarrierConfig> {
  const rules = carrierRulesJson.carriers as Record<string, Partial<CarrierRulesEntry>>;
  const configs = {} as Record<CarrierId, CarrierConfig>;

  for (const carrierId of Object.keys(CARRIER_PHONE_MAP) as CarrierId[]) {
    const entry = rules[carrierId];
    if (!entry?.dispatch || entry.isClearinghouse === undefined || entry.minWaitDayForClaims === undefined) {
      throw new Error(`carrier-configs.json is missing dispatch rules for carrier "${carrierId}"`);
    }
    configs[carrierId] = {
      carrierId,
      displayName: entry.dispatch.displayName,
      phone: CARRIER_PHONE_MAP[carrierId],
      minWaitDays: entry.minWaitDayForClaims,
      avgHoldMinutes: entry.dispatch.avgHoldMinutes,
      isClearinghouse: entry.isClearinghouse,
      ivrHints: entry.dispatch.ivrHints,
      maxRecoverableAgeDays: entry.dispatch.maxRecoverableAgeDays,
      ivrAlias: entry.dispatch.ivrAlias,
      supportsTransaction23: entry.dispatch.supportsTransaction23,
      portalFirstDispatch: entry.dispatch.portalFirstDispatch,
    };
  }

  return configs;
}

export const CARRIER_CONFIGS: Record<CarrierId, CarrierConfig> = buildCarrierConfigs();

// ---------------------------------------------------------------------------
// TELUS TPA supplementary configs
//
// These are the underlying TPAs accessed via TELUS AdjudiCare (clearinghouse).
// Carrier IDs match the numeric IDs used in CDAnet/ITRANS.
// ---------------------------------------------------------------------------

export interface TelusTpaConfig {
  /** CDAnet carrier numeric ID */
  carrierId: string;
  /** Official current name */
  displayName: string;
  /**
   * Display alias used by IVR_Navigator / Claims_Agent in voice interactions.
   * Set when the carrier recently rebranded (e.g. La Capitale → Beneva).
   */
  ivrAlias?: string;
  /**
   * CDAnet Transaction 23 (PreDetermination EOB) support for instant
   * electronic adjudication bypass — no IVR call needed.
   */
  supportsTransaction23?: boolean;
}

/**
 * TPA-level overrides for carriers accessed through TELUS AdjudiCare.
 * Keyed by CDAnet carrier numeric ID string.
 */
export const TELUS_TPA_CONFIGS: Record<string, TelusTpaConfig> = {
  // Beneva (ID 600502) — rebranded from La Capitale in 2023.
  // IVR_Navigator and Claims_Agent must use "Beneva" in all interactions.
  '600502': {
    carrierId: '600502',
    displayName: 'Beneva',
    ivrAlias: 'Beneva',   // Never say "La Capitale" — brand name is now Beneva
  },

  // Industrial Alliance (ID 000060) — supports Tx23 PreDetermination EOB.
  // Use electronic adjudication bypass before falling back to IVR.
  '000060': {
    carrierId: '000060',
    displayName: 'Industrial Alliance',
    supportsTransaction23: true,
  },

  // Saskatchewan Blue Cross (ID 000096) — supports Tx23 PreDetermination EOB.
  '000096': {
    carrierId: '000096',
    displayName: 'Saskatchewan Blue Cross',
    supportsTransaction23: true,
  },
};

/**
 * Resolve the IVR display name for a TPA carrier.
 * Returns the ivrAlias if set, otherwise displayName.
 * Use this in all voice agent prompts — never hardcode carrier names.
 */
export function getTpaDisplayName(cdanetCarrierId: string): string {
  const cfg = TELUS_TPA_CONFIGS[cdanetCarrierId];
  if (!cfg) return cdanetCarrierId;
  return cfg.ivrAlias ?? cfg.displayName;
}

/**
 * Check whether a TPA supports Tx23 electronic adjudication bypass.
 * When true, attempt Tx23 before queuing a Vapi voice call.
 */
export function tpaSupportsTransaction23(cdanetCarrierId: string): boolean {
  return TELUS_TPA_CONFIGS[cdanetCarrierId]?.supportsTransaction23 === true;
}

// ---------------------------------------------------------------------------
// CARRIER_BLOCK pre-dispatch check
//
// This is the highest-risk guard. Must be called before EVERY call dispatch.
// One active block suspends ALL calls to that carrier for the practice.
// ---------------------------------------------------------------------------

/**
 * Check whether calls to a carrier are currently blocked for a practice.
 *
 * Returns `{ allowed: false }` if any active (resumed_at IS NULL) block exists
 * — either on this practice directly, or on a sibling practice under the same
 * Organization (DSO / multi-location group). CarrierBlockEvent is keyed only
 * on (practiceId, carrierId), so without the sibling check, one location
 * tripping automation detection would leave every other location in the same
 * group blind and still dialing the same carrier on the same voice model —
 * exactly the correlated risk a multi-location customer introduces that a
 * single-practice pilot never surfaces.
 *
 * Must be checked before every Vapi call dispatch — no exceptions.
 */
export async function checkCarrierBlock(
  prisma: PrismaClient,
  practiceId: string,
  carrierId: CarrierId,
): Promise<DispatchGuard> {
  const activeBlock = await prisma.carrierBlockEvent.findFirst({
    where: {
      practiceId,
      carrierId,
      resumedAt: null,          // null = block still active
    },
    orderBy: { blockedAt: 'desc' },
  });

  if (activeBlock) {
    return {
      allowed: false,
      code: 'CARRIER_BLOCK',
      reason: `CARRIER_BLOCK active for ${carrierId} since ${activeBlock.blockedAt.toISOString()}. ` +
              `Resume via POST /api/carriers/${carrierId}/unblock after investigation.`,
    };
  }

  // This practice's own organization membership is readable under its own
  // RLS scope (it is that practice's own row) — no bypass needed here.
  const orgMemberships = await prisma.organizationPractice.findMany({
    where: { practiceId },
    select: { organizationId: true },
  });

  if (orgMemberships.length > 0) {
    const organizationIds = orgMemberships.map((m) => m.organizationId);
    // A sibling practice's CarrierBlockEvent row belongs to a DIFFERENT
    // practiceId — reading it while scoped to this practice's own RLS
    // context would return zero rows under enforced RLS, not "no block
    // found" but a wrongly-scoped negative. Bypass only this specific
    // cross-practice read; every other query in this function stays scoped.
    const { runWithRlsBypass } = await import('../server/db/rlsContext.js');
    const siblingBlock = await runWithRlsBypass(async () => {
      const siblingMemberships = await prisma.organizationPractice.findMany({
        where: { organizationId: { in: organizationIds }, practiceId: { not: practiceId } },
        select: { practiceId: true },
      });
      const siblingPracticeIds = [...new Set(siblingMemberships.map((m) => m.practiceId))];
      if (siblingPracticeIds.length === 0) return null;

      return prisma.carrierBlockEvent.findFirst({
        where: {
          carrierId,
          resumedAt: null,
          practiceId: { in: siblingPracticeIds },
        },
        orderBy: { blockedAt: 'desc' },
      });
    });

    if (siblingBlock) {
      return {
        allowed: false,
        code: 'CARRIER_BLOCK',
        reason:
          `Another location in your organization tripped CARRIER_BLOCK for ${carrierId} ` +
          `on ${siblingBlock.blockedAt.toISOString()} — pausing this location's ${carrierId} ` +
          'calls as an organization-wide precaution until an authorized staff member reviews it.',
      };
    }
  }

  return { allowed: true };
}

/**
 * Fleet-wide concurrency ceiling per carrier. Several practices dialing the
 * same carrier at once reads as scraping/DDoS to carrier IVR security, not
 * organic volume, even when each individual practice is well within its own
 * limits — this is exactly the failure mode a multi-location group (several
 * practices sharing the same dominant carriers) introduces.
 *
 * The active-call snapshot must be gathered fleet-wide, outside any single
 * practice's RLS scope (see runWithRlsBypass in queueEngine.ts) — a query run
 * inside a practice-scoped RLS context would silently narrow to that one
 * practice's calls, defeating the point of a fleet-wide ceiling. Callers that
 * cannot supply a snapshot (e.g. a staff-initiated single-call trigger) skip
 * this guard rather than risk a wrongly-scoped count.
 */
export function checkCarrierConcurrency(
  carrierId: CarrierId,
  carrierActiveCounts: Map<CarrierId, number> | undefined,
): DispatchGuard {
  if (!carrierActiveCounts) return { allowed: true };

  const limit = CARRIER_CONCURRENCY_LIMITS[carrierId] ?? DEFAULT_CARRIER_CONCURRENCY_LIMIT;
  const active = carrierActiveCounts.get(carrierId) ?? 0;

  if (active >= limit) {
    return {
      allowed: false,
      code: 'CARRIER_CONCURRENCY_LIMIT',
      reason: `${active} calls already active to ${carrierId} fleet-wide (limit ${limit}). Waiting for a slot to free up.`,
    };
  }

  return { allowed: true };
}

/**
 * Hard gate: practice must be authorized to call this carrier before dispatch.
 *   - Voice agent enabled for the practice
 *   - Carrier enabled in practice settings
 *   - Billing Agent Authorization Letter (BAAL) on file
 *   - Provider number configured for the carrier
 */
export async function checkCarrierAuthorizationGate(
  prisma: PrismaClient,
  practiceId: string,
  carrierId: CarrierId,
): Promise<DispatchGuard> {
  const { getPracticeSettings } = await import('../server/services/practiceSettingsService.js');
  const settings = await getPracticeSettings(prisma, practiceId);
  const displayName = CARRIER_CONFIGS[carrierId]?.displayName ?? carrierId;

  if (!settings.voiceAgentEnabled) {
    return {
      allowed: false,
      code: 'VOICE_AGENT_DISABLED',
      reason:
        'Voice agent is disabled for this practice. Enable it in Practice Settings before placing carrier calls.',
    };
  }

  const carrierConfig = settings.carrierConfigs.find((c) => c.carrierId === carrierId);
  if (!carrierConfig) {
    return {
      allowed: false,
      code: 'CARRIER_NOT_AUTHORIZED',
      reason: `${displayName} is not configured for this practice. Add carrier settings before calling.`,
    };
  }

  if (!carrierConfig.enabled) {
    return {
      allowed: false,
      code: 'CARRIER_NOT_AUTHORIZED',
      reason: `${displayName} is disabled in Practice Settings. Enable the carrier before calling.`,
    };
  }

  if (!carrierConfig.authorizationSubmitted) {
    return {
      allowed: false,
      code: 'CARRIER_NOT_AUTHORIZED',
      reason:
        `Billing Agent Authorization Letter (BAAL) not on file for ${displayName}. ` +
        'Submit authorization in Practice Settings before calling this carrier.',
    };
  }

  const providerNumber = carrierConfig.providerNumber?.trim();
  if (!providerNumber) {
    return {
      allowed: false,
      code: 'CARRIER_NOT_AUTHORIZED',
      reason:
        `Provider number not configured for ${displayName}. ` +
        'Add your carrier provider number in Practice Settings before calling.',
    };
  }

  return { allowed: true };
}

/**
 * Validate all pre-dispatch call rules:
 *   1. CARRIER_BLOCK
 *   2. Fleet-wide per-carrier concurrency ceiling (when a snapshot is supplied)
 *   3. Claim lifecycle (`APPROVED_PENDING_PAYMENT` → no carrier dial)
 *   4. Practice carrier authorization (BAAL, provider number, voice agent enabled)
 *   5. Days outstanding (< 30 → reject, > 90 → escalate)
 *   6. TELUS-specific minimum days (when applicable)
 *   7. Max attempts (>= 3 → reject)
 *   8. Subscription monthly claim limit
 *   9. Call window (Mon–Fri 08:00–17:00 Eastern)
 */
export async function validateDispatch(
  prisma: PrismaClient,
  params: {
    practiceId: string;
    claimId: string;
    carrierId: CarrierId;
    daysOutstanding: number;
    attemptsSoFar: number;
    scheduledFor?: Date;
    /** Required: workflow rules (e.g. no carrier dial for `APPROVED_PENDING_PAYMENT`). */
    claimStatus: ClaimStatus;
    /** Fleet-wide active-call-per-carrier snapshot, gathered outside RLS scope. Omit to skip the concurrency guard. */
    carrierActiveCounts?: Map<CarrierId, number>;
  },
): Promise<DispatchGuard> {
  const { practiceId, claimId, carrierId, daysOutstanding, attemptsSoFar, scheduledFor, claimStatus, carrierActiveCounts } = params;

  // 1. CARRIER_BLOCK — highest priority check
  const blockGuard = await checkCarrierBlock(prisma, practiceId, carrierId);
  if (!blockGuard.allowed) return blockGuard;

  // 2. Fleet-wide per-carrier concurrency ceiling
  const concurrencyGuard = checkCarrierConcurrency(carrierId, carrierActiveCounts);
  if (!concurrencyGuard.allowed) return concurrencyGuard;

  // 3. Carrier approved but payment not received — follow up in practice AR, not another carrier dial
  if (claimStatus === 'APPROVED_PENDING_PAYMENT') {
    return {
      allowed: false,
      code: 'APPROVED_PENDING_PAYMENT',
      reason:
        'Claim is APPROVED_PENDING_PAYMENT — payment follow-up belongs in practice AR, not another carrier call.',
    };
  }

  const { checkRecoveryDispatchGate } = await import('../server/recovery/dispatchGate.js');
  const recoveryGate = await checkRecoveryDispatchGate(prisma, claimId, scheduledFor);
  if (!recoveryGate.allowed) {
    return { allowed: false, code: 'RECOVERY_GATE', reason: recoveryGate.reason };
  }

  const authGate = await checkCarrierAuthorizationGate(prisma, practiceId, carrierId);
  if (!authGate.allowed) {
    return authGate;
  }

  // 5. Claims under 30 days old — do not queue
  const config = CARRIER_CONFIGS[carrierId];
  if (daysOutstanding < 30) {
    return { allowed: false, code: 'CLAIM_TOO_YOUNG', reason: `Claim only ${daysOutstanding} days outstanding (min 30 days required)` };
  }

  // 6. TELUS minimum day 21 — but our global minimum is 30, so this is informational only
  if (carrierId === 'telus_adjudicare' && daysOutstanding < config.minWaitDays) {
    return { allowed: false, code: 'CLAIM_TOO_YOUNG', reason: `TELUS requires minimum ${config.minWaitDays} days (currently ${daysOutstanding})` };
  }

  // 7. Claims over 90 days — escalate to human, skip AI
  if (daysOutstanding > 90) {
    return { allowed: false, code: 'ESCALATE_OVER_90', reason: `Claim ${daysOutstanding} days outstanding — escalate to human (> 90 days rule)` };
  }

  // 8. Max 3 attempts
  if (attemptsSoFar >= 3) {
    return { allowed: false, code: 'MAX_ATTEMPTS', reason: `Maximum 3 call attempts reached (${attemptsSoFar} so far)` };
  }

  // 8b. Subscription monthly claim limit
  const subscriptionGuard = await validateSubscriptionClaimCapacity(prisma, {
    practiceId,
    claimId,
    now: scheduledFor ?? new Date(),
  });
  if (!subscriptionGuard.allowed) {
    return {
      allowed: false,
      code: subscriptionGuard.code,
      reason: subscriptionGuard.reason,
    };
  }

  // 9. Business hours check (Mon–Fri 08:00–17:00 Eastern)
  const callTime = scheduledFor ?? new Date();
  if (!isWithinCallWindow(callTime)) {
    const easternHour = getEasternHour(callTime);
    const dayOfWeek = getEasternDayOfWeek(callTime);
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return { allowed: false, code: 'OUTSIDE_CALL_WINDOW', reason: 'Calls only permitted Mon–Fri (Eastern time)' };
    }
    return { allowed: false, code: 'OUTSIDE_CALL_WINDOW', reason: `Calls only permitted 08:00–17:00 Eastern (current Eastern hour: ${easternHour})` };
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// TELUS TPA helper
// ---------------------------------------------------------------------------

/**
 * For TELUS AdjudiCare claims: identify the underlying TPA from the group
 * number prefix before routing the IVR call. Returns null if not identified.
 */
export function getTelusTpa(memberId: string, groupNumber: string): string | null {
  try {
    const result = identifyTelusPlan(memberId, groupNumber);
    return result.identifiedTpa;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Time helpers (Eastern time)
// ---------------------------------------------------------------------------

function getEasternHour(date: Date): number {
  return parseInt(
    date.toLocaleString('en-CA', { timeZone: 'America/Toronto', hour: 'numeric', hour12: false }),
    10,
  );
}

function getEasternDayOfWeek(date: Date): number {
  const dayStr = date.toLocaleString('en-CA', {
    timeZone: 'America/Toronto',
    weekday: 'short',
  });
  const days: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return days[dayStr] ?? date.getDay();
}

/**
 * Test/staging escape hatch ONLY — refuses to activate in production, where
 * the Mon–Fri 08:00–17:00 Eastern window is a hard compliance rule.
 */
export function callWindowForced(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.COLLECTRX_FORCE_CALL_WINDOW === '1'
  );
}

export function isWithinCallWindow(date = new Date()): boolean {
  if (callWindowForced()) return true;
  const hour = getEasternHour(date);
  const day = getEasternDayOfWeek(date);
  return day >= 1 && day <= 5 && hour >= 8 && hour < 17;
}

/**
 * Returns the first top-of-hour instant inside the shared carrier call window.
 * The scan uses isWithinCallWindow so its DST and test-mode behavior cannot
 * drift from the dispatch gate.
 */
export function nextCallWindowStart(date = new Date()): Date {
  if (isWithinCallWindow(date)) return date;

  const candidate = new Date(date);
  candidate.setMinutes(0, 0, 0);
  candidate.setHours(candidate.getHours() + 1);

  for (let hoursAhead = 0; hoursAhead <= 8 * 24; hoursAhead += 1) {
    if (isWithinCallWindow(candidate)) return candidate;
    candidate.setHours(candidate.getHours() + 1);
  }

  throw new Error('Unable to determine the next carrier call window');
}

export const carrierAdapter = {
  CARRIER_CONFIGS,
  TELUS_TPA_CONFIGS,
  checkCarrierBlock,
  checkCarrierConcurrency,
  checkCarrierAuthorizationGate,
  validateDispatch,
  getTelusTpa,
  getTpaDisplayName,
  tpaSupportsTransaction23,
  isWithinCallWindow,
  nextCallWindowStart,
} as const;

export default carrierAdapter;
