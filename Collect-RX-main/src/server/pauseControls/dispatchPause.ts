import type { CarrierId, PrismaClient } from '@prisma/client';
import { runWithRlsBypass } from '../db/rlsContext.js';
import { logger } from '../observability/logger.js';

/**
 * Operator pause controls for outbound carrier calls (pilot item R6 / G3).
 *
 * State lives in the existing feature_flags table, so a pause takes effect on
 * the very next dispatch decision with no cache and no deploy. Three scopes:
 *
 *   system    one row, practice_id NULL              stops every practice
 *   practice  one row per practice                   stops one practice
 *   carrier   practice_id NULL (all practices) or    stops one carrier, fleet-wide
 *             a practice id (one practice only)      or for one practice
 *
 * Pausing only stops NEW dials. A call already live is left alone so a rep
 * and staff mid-conversation are not cut off; CARRIER_BLOCK remains the
 * mechanism that terminates live calls.
 */
export const DISPATCH_PAUSE_FEATURES = {
  SYSTEM: 'dispatch_pause.system',
  PRACTICE: 'dispatch_pause.practice',
} as const;

const CARRIER_PREFIX = 'dispatch_pause.carrier.';

export function carrierPauseFeature(carrierId: CarrierId): string {
  return `${CARRIER_PREFIX}${carrierId}`;
}

export type DispatchPauseScope = 'system' | 'practice' | 'carrier';

export type DispatchPauseGuard =
  | { allowed: true }
  | { allowed: false; code: DispatchPauseCode; reason: string };

export type DispatchPauseCode =
  | 'PAUSED_SYSTEM'
  | 'PAUSED_PRACTICE'
  | 'PAUSED_CARRIER'
  | 'PAUSE_STATE_UNAVAILABLE';

/** Longest operator note kept on a pause row. The note must never hold patient information. */
export const PAUSE_REASON_MAX_LENGTH = 200;

/**
 * Decides whether a dial for this practice and carrier is paused. Fails
 * closed: if the pause state cannot be read, the dial is refused.
 */
export async function checkDispatchPause(
  prisma: PrismaClient,
  params: { practiceId: string; carrierId: CarrierId },
): Promise<DispatchPauseGuard> {
  const { practiceId, carrierId } = params;
  const carrierFeature = carrierPauseFeature(carrierId);
  try {
    // Global rows (practice_id NULL) are invisible to a practice-scoped
    // session, so this read runs outside tenant scope. It selects pause flags
    // only, never claim or patient data.
    const rows = await runWithRlsBypass(() =>
      prisma.featureFlag.findMany({
        where: {
          paused: true,
          feature: { in: [DISPATCH_PAUSE_FEATURES.SYSTEM, DISPATCH_PAUSE_FEATURES.PRACTICE, carrierFeature] },
          OR: [{ practiceId: null }, { practiceId }],
        },
        select: { feature: true, practiceId: true, pauseReason: true },
      }),
    );

    const system = rows.find((r) => r.feature === DISPATCH_PAUSE_FEATURES.SYSTEM && r.practiceId === null);
    if (system) {
      return { allowed: false, code: 'PAUSED_SYSTEM', reason: withNote('All calling is paused platform-wide', system.pauseReason) };
    }
    const practice = rows.find((r) => r.feature === DISPATCH_PAUSE_FEATURES.PRACTICE && r.practiceId === practiceId);
    if (practice) {
      return { allowed: false, code: 'PAUSED_PRACTICE', reason: withNote('Calling is paused for this practice', practice.pauseReason) };
    }
    const carrier = rows.find((r) => r.feature === carrierFeature);
    if (carrier) {
      return {
        allowed: false,
        code: 'PAUSED_CARRIER',
        reason: withNote(`Calling to ${carrierId} is paused`, carrier.pauseReason),
      };
    }
    return { allowed: true };
  } catch (error) {
    logger.error('[dispatchPause] pause state unreadable, refusing dial (fail closed)', { error });
    return {
      allowed: false,
      code: 'PAUSE_STATE_UNAVAILABLE',
      reason: 'Pause state could not be read, so calling is held until it can be.',
    };
  }
}

function withNote(prefix: string, note: string | null): string {
  return note ? `${prefix}: ${note}` : prefix;
}

export interface PauseTarget {
  scope: DispatchPauseScope;
  practiceId: string | null;
  carrierId?: CarrierId;
}

function featureFor(target: PauseTarget): { practiceId: string | null; feature: string } {
  switch (target.scope) {
    case 'system':
      return { practiceId: null, feature: DISPATCH_PAUSE_FEATURES.SYSTEM };
    case 'practice':
      return { practiceId: target.practiceId, feature: DISPATCH_PAUSE_FEATURES.PRACTICE };
    case 'carrier':
      if (!target.carrierId) throw new Error('carrierId is required for a carrier pause');
      return { practiceId: target.practiceId, feature: carrierPauseFeature(target.carrierId) };
  }
}

/**
 * Turns one pause on or off. Resuming updates every matching row, because the
 * table's unique key does not stop two rows with a NULL practice id.
 */
export async function setDispatchPause(
  prisma: PrismaClient,
  target: PauseTarget,
  paused: boolean,
  reason: string | null,
): Promise<void> {
  const { practiceId, feature } = featureFor(target);
  const data = { paused, pauseReason: paused ? reason : null, pausedAt: paused ? new Date() : null };
  await runWithRlsBypass(async () => {
    const updated = await prisma.featureFlag.updateMany({ where: { practiceId, feature }, data });
    if (updated.count === 0 && paused) {
      await prisma.featureFlag.create({
        data: { practiceId, feature, resumeRequiresManualConfirmation: true, ...data },
      });
    }
  });
}

export interface ActivePause {
  scope: DispatchPauseScope;
  practiceId: string | null;
  carrierId: string | null;
  reason: string | null;
  pausedAt: Date | null;
}

/** Every pause currently in force, for the operator view. */
export async function listActiveDispatchPauses(prisma: PrismaClient): Promise<ActivePause[]> {
  const rows = await runWithRlsBypass(() =>
    prisma.featureFlag.findMany({
      where: {
        paused: true,
        OR: [
          { feature: { in: [DISPATCH_PAUSE_FEATURES.SYSTEM, DISPATCH_PAUSE_FEATURES.PRACTICE] } },
          { feature: { startsWith: CARRIER_PREFIX } },
        ],
      },
      select: { feature: true, practiceId: true, pauseReason: true, pausedAt: true },
      orderBy: { pausedAt: 'desc' },
    }),
  );
  return rows.map((r) => {
    if (r.feature === DISPATCH_PAUSE_FEATURES.SYSTEM) {
      return { scope: 'system', practiceId: null, carrierId: null, reason: r.pauseReason, pausedAt: r.pausedAt };
    }
    if (r.feature === DISPATCH_PAUSE_FEATURES.PRACTICE) {
      return { scope: 'practice', practiceId: r.practiceId, carrierId: null, reason: r.pauseReason, pausedAt: r.pausedAt };
    }
    return {
      scope: 'carrier',
      practiceId: r.practiceId,
      carrierId: r.feature.slice(CARRIER_PREFIX.length),
      reason: r.pauseReason,
      pausedAt: r.pausedAt,
    };
  });
}
