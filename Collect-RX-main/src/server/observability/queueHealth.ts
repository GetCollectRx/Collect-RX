/**
 * Queue-health signals — the product IS the call queue, so its health must be
 * observable. Every silent-stall bug found in the July 2026 reliability audit
 * (head-of-queue starvation, hung tick latch, lost-webhook lock) would have
 * shown up here as a climbing age within an hour of deploy.
 */
import type { PrismaClient } from '@prisma/client';
import { isWithinCallWindow } from '../../carriers/adapter.js';
import { runWithRlsBypass } from '../db/rlsContext.js';
import { getDeskQueueTickHealth } from '../frontDesk/queueEngine.js';

export interface QueueHealthSnapshot {
  /** PENDING queue entries whose scheduledFor has passed (eligible right now). */
  duePendingCount: number;
  /** Minutes the longest-waiting due entry has been eligible; null when none. */
  oldestDuePendingAgeMinutes: number | null;
  /** Call attempts with no completedAt — each holds a practice's dispatch lock. */
  openCallAttempts: number;
  oldestOpenAttemptAgeMinutes: number | null;
  withinCallWindow: boolean;
  /** P0.5 — single-instance tick health from this process's desk queue engine. */
  lastSuccessfulTickAt: string | null;
  consecutiveTickFailures: number;
  lastTickFailureAt: string | null;
}

export async function getQueueHealth(prisma: PrismaClient): Promise<QueueHealthSnapshot> {
  const now = new Date();
  return runWithRlsBypass(async () => {
    const [duePendingCount, oldestDue, openCallAttempts, oldestAttempt] = await Promise.all([
      prisma.callQueue.count({
        where: { status: 'PENDING', scheduledFor: { lte: now } },
      }),
      prisma.callQueue.findFirst({
        where: { status: 'PENDING', scheduledFor: { lte: now } },
        orderBy: { scheduledFor: 'asc' },
        select: { scheduledFor: true },
      }),
      prisma.callAttempt.count({ where: { completedAt: null } }),
      prisma.callAttempt.findFirst({
        where: { completedAt: null },
        orderBy: { initiatedAt: 'asc' },
        select: { initiatedAt: true },
      }),
    ]);

    const ageMinutes = (d: Date | undefined | null): number | null =>
      d ? Math.floor((now.getTime() - d.getTime()) / 60_000) : null;

    const tickHealth = getDeskQueueTickHealth();

    return {
      duePendingCount,
      oldestDuePendingAgeMinutes: ageMinutes(oldestDue?.scheduledFor),
      openCallAttempts,
      oldestOpenAttemptAgeMinutes: ageMinutes(oldestAttempt?.initiatedAt),
      withinCallWindow: isWithinCallWindow(),
      lastSuccessfulTickAt: tickHealth.lastSuccessfulTickAt,
      consecutiveTickFailures: tickHealth.consecutiveTickFailures,
      lastTickFailureAt: tickHealth.lastTickFailureAt,
    };
  });
}

export interface QueueHealthAlert {
  alertId: 'queue_dispatch_stalled' | 'call_attempt_stuck';
  detail: string;
}

export interface QueueHealthThresholds {
  /** Minutes a due claim may wait inside the call window before alerting. */
  stallMinutes: number;
  /** Minutes an open call attempt may live before alerting (below the 180-min watchdog). */
  stuckAttemptMinutes: number;
}

export function defaultQueueHealthThresholds(): QueueHealthThresholds {
  return {
    // P0.5 — reduced from 30 to 5: a 30-minute silent stall in an unsupervised
    // pilot go-live is far too slow to notice; 5 minutes still comfortably
    // exceeds one tick interval (60s) plus this engine's own backoff/retry.
    stallMinutes: Math.max(5, Number(process.env.OPS_ALERT_QUEUE_STALL_MINUTES || 5)),
    stuckAttemptMinutes: Math.max(30, Number(process.env.OPS_ALERT_ATTEMPT_STUCK_MINUTES || 150)),
  };
}

/**
 * Pure decision function so the alert conditions are unit-testable apart from
 * the monitor loop. Outside the call window a due claim waiting is normal —
 * the stall alert only fires when the engine should be dialing and is not.
 */
export function evaluateQueueHealthAlerts(
  snapshot: QueueHealthSnapshot,
  thresholds: QueueHealthThresholds,
): QueueHealthAlert[] {
  const alerts: QueueHealthAlert[] = [];

  if (
    snapshot.withinCallWindow &&
    snapshot.duePendingCount > 0 &&
    snapshot.oldestDuePendingAgeMinutes !== null &&
    snapshot.oldestDuePendingAgeMinutes >= thresholds.stallMinutes
  ) {
    alerts.push({
      alertId: 'queue_dispatch_stalled',
      detail:
        `${snapshot.duePendingCount} due claim(s) waiting; oldest has been eligible ` +
        `${snapshot.oldestDuePendingAgeMinutes} min inside the call window.`,
    });
  }

  if (
    snapshot.oldestOpenAttemptAgeMinutes !== null &&
    snapshot.oldestOpenAttemptAgeMinutes >= thresholds.stuckAttemptMinutes
  ) {
    alerts.push({
      alertId: 'call_attempt_stuck',
      detail:
        `Open call attempt is ${snapshot.oldestOpenAttemptAgeMinutes} min old ` +
        `(${snapshot.openCallAttempts} open total) — end-of-call webhook may have been lost.`,
    });
  }

  return alerts;
}
