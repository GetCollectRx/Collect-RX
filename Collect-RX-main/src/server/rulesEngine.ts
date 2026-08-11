import { PrismaClient } from '@prisma/client';
import { syncCallQueueSchedulingFromPriority } from './services/priorityEngine.js';
import { syncWorkItemsForPractice } from './services/workQueueService.js';
import { processEmrSyncOutboxBatch } from './emrSyncOutbox.js';
import { processPaymentTraceDue } from './recovery/recoveryLoopService.js';
import { escalateOverdueRecoveryActions } from './recovery/overdueActionEscalation.js';
import { dispatchRecoveryPracticeAlerts } from './recovery/recoveryNotifications.js';
import { runDailyArCloseAllPractices } from './jobs/dailyArClose.js';
import { sweepUpcomingAppointmentsAcrossPractices } from './preVisit/appointmentIngest.js';
import {
  ensureMonthlyDiscoveryRoster,
  isCarrierDiscoveryEnabled,
} from './discovery/carrierDiscoveryService.js';
import { runWithRlsBypass, runWithPracticeRls } from './db/rlsContext.js';
import { logger } from './observability/logger.js';

/**
 * Insurance operations tick: call queue priority, EMR outbox, payment trace recalls,
 * recovery alerts, daily AR close, and work-queue sync. Legacy patient Balance outreach
 * was removed — CollectRx is insurance-carrier recovery only.
 */
export async function runRulesEngineTick(prisma: PrismaClient): Promise<void> {
  await runWithRlsBypass(async () => {
  try {
    const sync = await syncCallQueueSchedulingFromPriority(prisma);
    if (sync.rowsUpdated > 0) {
      logger.info('[rulesEngine] priority queue sync', { rowsUpdated: sync.rowsUpdated, practices: sync.practices });
    }
  } catch (err) {
    logger.error('[rulesEngine] priority queue sync failed', { error: err });
  }

  try {
    const emr = await processEmrSyncOutboxBatch(prisma);
    if (emr.markedProcessed > 0 || emr.deliveryFailed > 0) {
      logger.info('[rulesEngine] EMR outbox', {
        pulled: emr.pulled,
        processed: emr.markedProcessed,
        failed: emr.deliveryFailed,
      });
    }
  } catch (err) {
    logger.error('[rulesEngine] EMR outbox batch failed', { error: err });
  }

  try {
    const traced = await processPaymentTraceDue(prisma);
    if (traced > 0) {
      logger.info('[rulesEngine] payment trace recalls scheduled', { traced });
    }
  } catch (err) {
    logger.error('[rulesEngine] payment trace due failed', { error: err });
  }

  try {
    const overdueEscalated = await escalateOverdueRecoveryActions(prisma);
    if (overdueEscalated > 0) {
      logger.info('[rulesEngine] overdue practice actions escalated', { overdueEscalated });
    }
  } catch (err) {
    logger.error('[rulesEngine] overdue action sweep failed', { error: err });
  }

  const now = new Date();
  if (now.getUTCMinutes() === 0) {
    try {
      const practices = await prisma.practice.findMany({ select: { id: true } });
      for (const p of practices) {
        await runWithPracticeRls(p.id, async () => {
          await syncWorkItemsForPractice(prisma, p.id);
          await dispatchRecoveryPracticeAlerts(prisma, p.id);
        });
      }
    } catch (err) {
      logger.error('[rulesEngine] hourly work queue / recovery alerts failed', { error: err });
    }
  }

  const closeHour = parseInt(process.env.AR_CLOSE_UTC_HOUR ?? '23', 10);
  if (now.getUTCHours() === closeHour && now.getUTCMinutes() < 2) {
    try {
      await runDailyArCloseAllPractices(prisma);
    } catch (err) {
      logger.error('[rulesEngine] daily AR close failed', { error: err });
    }
  }

  // Monthly IVR discovery roster: one silent listener call per carrier per
  // month keeps navigation maps current before live calls fail on a changed
  // menu. ensureMonthlyDiscoveryRoster is idempotent per calendar month, so an
  // hourly check just guarantees the roster exists even after restarts.
  if (now.getUTCMinutes() === 10 && isCarrierDiscoveryEnabled()) {
    try {
      const created = await ensureMonthlyDiscoveryRoster(prisma);
      if (created > 0) {
        logger.info('[rulesEngine] monthly IVR discovery roster', { carrierRunsScheduled: created });
      }
    } catch (err) {
      logger.error('[rulesEngine] monthly discovery roster failed', { error: err });
    }
  }

  // Pre-visit: sweep upcoming appointments once per hour at minute 5.
  if (now.getUTCMinutes() === 5) {
    try {
      const swept = await sweepUpcomingAppointmentsAcrossPractices(prisma);
      if (swept > 0) {
        logger.info('[rulesEngine] pre-visit sweep verified appointments', { swept });
      }
    } catch (err) {
      logger.error('[rulesEngine] pre-visit appointment sweep failed', { error: err });
    }
  }
  });
}

export function startRulesEngine(prisma: PrismaClient) {
  logger.info('[rulesEngine] insurance ops engine started — evaluating every 60 seconds (in-process)', {});

  // M-2: prevent concurrent ticks — if a tick takes longer than 60 seconds
  // (large EMR outbox batch, many practices), the next interval fires but
  // returns immediately rather than running syncWorkItems / outbox drain twice.
  let isRunning = false;

  const evaluateRules = async () => {
    if (isRunning) {
      logger.warn('[rulesEngine] previous tick still running — skipping', {});
      return;
    }
    isRunning = true;
    try {
      await runRulesEngineTick(prisma);
    } catch (error) {
      logger.error('[rulesEngine] rules engine error', { error });
    } finally {
      isRunning = false;
    }
  };

  void evaluateRules();
  setInterval(evaluateRules, 60000);
}
