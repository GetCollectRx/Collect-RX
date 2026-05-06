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

import type { CarrierId, PrismaClient } from '@prisma/client';
import { CARRIER_PHONE_MAP } from '../vapi/client';
import { identifyTelusPlan } from '../services/eligibility/engine';

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
}

export interface DispatchGuard {
  allowed: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Per-carrier configuration
// ---------------------------------------------------------------------------

export const CARRIER_CONFIGS: Record<CarrierId, CarrierConfig> = {
  sun_life: {
    carrierId: 'sun_life',
    displayName: 'Sun Life Financial',
    phone: CARRIER_PHONE_MAP.sun_life,
    minWaitDays: 32,
    avgHoldMinutes: 18,
    isClearinghouse: false,
    ivrHints: ['Press 2 for dental claims', 'Enter group number, then member ID'],
  },
  canada_life: {
    carrierId: 'canada_life',
    displayName: 'Canada Life',
    phone: CARRIER_PHONE_MAP.canada_life,
    minWaitDays: 32,
    avgHoldMinutes: 22,
    isClearinghouse: false,
    ivrHints: ['Press 3 for claim status', 'Enter plan number followed by pound'],
  },
  manulife: {
    carrierId: 'manulife',
    displayName: 'Manulife',
    phone: CARRIER_PHONE_MAP.manulife,
    minWaitDays: 32,
    avgHoldMinutes: 15,
    isClearinghouse: false,
    ivrHints: ['Press 1 for English', 'Press 2 for benefits inquiries'],
  },
  green_shield: {
    carrierId: 'green_shield',
    displayName: 'Green Shield Canada',
    phone: CARRIER_PHONE_MAP.green_shield,
    minWaitDays: 32,
    avgHoldMinutes: 20,
    isClearinghouse: false,
    ivrHints: ['Press 2 for provider inquiries', 'Provide certificate number'],
  },
  rbc: {
    carrierId: 'rbc',
    displayName: 'RBC Insurance',
    phone: CARRIER_PHONE_MAP.rbc,
    minWaitDays: 32,
    avgHoldMinutes: 16,
    isClearinghouse: false,
    ivrHints: ['Press 3 for group benefits', 'Enter policy number when prompted'],
  },
  telus_adjudicare: {
    carrierId: 'telus_adjudicare',
    displayName: 'TELUS AdjudiCare',
    phone: CARRIER_PHONE_MAP.telus_adjudicare,
    minWaitDays: 21,           // TELUS minimum is day 21, not day 32
    avgHoldMinutes: 12,
    isClearinghouse: true,     // Routes to underlying TPA — identify TPA first
    ivrHints: [
      'TELUS is a clearinghouse — identify TPA from group number prefix first',
      'TPA identification required before IVR navigation',
    ],
  },
};

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
      reason: `CARRIER_BLOCK active for ${carrierId} since ${activeBlock.blockedAt.toISOString()}. ` +
              `Resume via POST /api/carriers/${carrierId}/unblock after investigation.`,
    };
  }

  return { allowed: true };
}

/**
 * Validate all pre-dispatch call rules:
 *   1. CARRIER_BLOCK
 *   2. Days outstanding (< 30 → reject, > 90 → escalate)
 *   3. Max attempts (>= 3 → reject)
 *   4. Call window (Mon–Fri 08:00–17:00 Eastern)
 */
export async function validateDispatch(
  prisma: PrismaClient,
  params: {
    practiceId: string;
    carrierId: CarrierId;
    daysOutstanding: number;
    attemptsSoFar: number;
    scheduledFor?: Date;
  },
): Promise<DispatchGuard> {
  const { practiceId, carrierId, daysOutstanding, attemptsSoFar, scheduledFor } = params;

  // 1. CARRIER_BLOCK — highest priority check
  const blockGuard = await checkCarrierBlock(prisma, practiceId, carrierId);
  if (!blockGuard.allowed) return blockGuard;

  // 2. Claims under 30 days old — do not queue
  const config = CARRIER_CONFIGS[carrierId];
  if (daysOutstanding < 30) {
    return { allowed: false, reason: `Claim only ${daysOutstanding} days outstanding (min 30 days required)` };
  }

  // 3. TELUS minimum day 21 — but our global minimum is 30, so this is informational only
  if (carrierId === 'telus_adjudicare' && daysOutstanding < config.minWaitDays) {
    return { allowed: false, reason: `TELUS requires minimum ${config.minWaitDays} days (currently ${daysOutstanding})` };
  }

  // 4. Claims over 90 days — escalate to human, skip AI
  if (daysOutstanding > 90) {
    return { allowed: false, reason: `Claim ${daysOutstanding} days outstanding — escalate to human (> 90 days rule)` };
  }

  // 5. Max 3 attempts
  if (attemptsSoFar >= 3) {
    return { allowed: false, reason: `Maximum 3 call attempts reached (${attemptsSoFar} so far)` };
  }

  // 6. Business hours check (Mon–Fri 08:00–17:00 Eastern)
  const callTime = scheduledFor ?? new Date();
  const easternHour = getEasternHour(callTime);
  const dayOfWeek = getEasternDayOfWeek(callTime);
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return { allowed: false, reason: 'Calls only permitted Mon–Fri (Eastern time)' };
  }
  if (easternHour < 8 || easternHour >= 17) {
    return { allowed: false, reason: `Calls only permitted 08:00–17:00 Eastern (current Eastern hour: ${easternHour})` };
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

export function isWithinCallWindow(date = new Date()): boolean {
  const hour = getEasternHour(date);
  const day = getEasternDayOfWeek(date);
  return day >= 1 && day <= 5 && hour >= 8 && hour < 17;
}

export const carrierAdapter = {
  CARRIER_CONFIGS,
  checkCarrierBlock,
  validateDispatch,
  getTelusTpa,
  isWithinCallWindow,
} as const;

export default carrierAdapter;
