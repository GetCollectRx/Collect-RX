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
import carrierRulesJson from '../services/eligibility/rules/carrier-configs.json';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CarrierConfig {
  carrierId: CarrierId;
  displayName: string;
  /** Direct-dial number for claims department */
  phone: string;
  /**
   * Documented carrier SLA for minimum days outstanding before calling — day
   * 21 for TELUS, day 32 for others. Not currently enforced by
   * `validateDispatch`, which applies a flat 30-day floor to every carrier
   * instead (see docs/operations/HUMAN-DECISIONS-PENDING.md item 1).
   */
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
 * Returns `{ allowed: false }` if any active (resumed_at IS NULL) block exists.
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
 *   2. Claim lifecycle (`APPROVED_PENDING_PAYMENT` → no carrier dial)
 *   3. Recovery dispatch gate (practice-side blockers)
 *   4. Practice carrier authorization (BAAL, provider number, voice agent enabled)
 *   5. Days outstanding (< 30 → reject for every carrier, > 90 → escalate). Flat
 *      floor for every carrier today — CARRIER_CONFIGS.minWaitDays documents
 *      per-carrier SLAs (21 days TELUS, 32 others) but enforcing those instead
 *      of this flat 30 is a pending product decision, not an engineering gap —
 *      see docs/operations/HUMAN-DECISIONS-PENDING.md item 1.
 *   6. Max attempts (>= 3 → reject)
 *   7. Call window (Mon–Fri 08:00–17:00 Eastern)
 *
 * Subscription/usage capacity (canMakeCall()) is enforced by the caller
 * (queueEngine.ts) before this function runs, not here.
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
  },
): Promise<DispatchGuard> {
  const { practiceId, claimId, carrierId, daysOutstanding, attemptsSoFar, scheduledFor, claimStatus } = params;

  // 1. CARRIER_BLOCK — highest priority check
  const blockGuard = await checkCarrierBlock(prisma, practiceId, carrierId);
  if (!blockGuard.allowed) return blockGuard;

  // 2. Carrier approved but payment not received — follow up in practice AR, not another carrier dial
  if (claimStatus === 'APPROVED_PENDING_PAYMENT') {
    return {
      allowed: false,
      code: 'APPROVED_PENDING_PAYMENT',
      reason:
        'Claim is APPROVED_PENDING_PAYMENT — payment follow-up belongs in practice AR, not another carrier call.',
    };
  }

  // 3. Recovery dispatch gate
  const { checkRecoveryDispatchGate } = await import('../server/recovery/dispatchGate.js');
  const recoveryGate = await checkRecoveryDispatchGate(prisma, claimId, scheduledFor);
  if (!recoveryGate.allowed) {
    return { allowed: false, code: 'RECOVERY_GATE', reason: recoveryGate.reason };
  }

  // 4. Practice carrier authorization
  const authGate = await checkCarrierAuthorizationGate(prisma, practiceId, carrierId);
  if (!authGate.allowed) {
    return authGate;
  }

  // 5. Claims under 30 days old — do not queue. This is a flat floor for every
  // carrier: CARRIER_CONFIGS.minWaitDays documents per-carrier SLAs (21 days
  // for TELUS, 32 for the rest) but nothing in dispatch consults that field —
  // see docs/operations/HUMAN-DECISIONS-PENDING.md item 1 for the decision on
  // whether to enforce those per-carrier numbers instead of this flat one.
  if (daysOutstanding < 30) {
    return { allowed: false, code: 'CLAIM_TOO_YOUNG', reason: `Claim only ${daysOutstanding} days outstanding (min 30 days required)` };
  }

  // 6. Claims over 90 days — escalate to human, skip AI
  if (daysOutstanding > 90) {
    return { allowed: false, code: 'ESCALATE_OVER_90', reason: `Claim ${daysOutstanding} days outstanding — escalate to human (> 90 days rule)` };
  }

  // 7. Max 3 attempts
  if (attemptsSoFar >= 3) {
    return { allowed: false, code: 'MAX_ATTEMPTS', reason: `Maximum 3 call attempts reached (${attemptsSoFar} so far)` };
  }

  // 8. Business hours check (Mon–Fri 08:00–17:00 Eastern)
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
  checkCarrierAuthorizationGate,
  validateDispatch,
  getTelusTpa,
  getTpaDisplayName,
  tpaSupportsTransaction23,
  isWithinCallWindow,
  nextCallWindowStart,
} as const;

export default carrierAdapter;
