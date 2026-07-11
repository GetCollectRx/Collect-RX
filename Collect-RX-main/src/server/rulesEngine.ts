import { PrismaClient } from '@prisma/client';
import { syncCallQueueSchedulingFromPriority } from './services/priorityEngine.js';
import { syncWorkItemsForPractice } from './services/workQueueService.js';
import { processEmrSyncOutboxBatch } from './emrSyncOutbox.js';
import { processPaymentTraceDue } from './recovery/recoveryLoopService.js';
import { escalateOverdueRecoveryActions } from './recovery/overdueActionEscalation.js';
import { dispatchRecoveryPracticeAlerts } from './recovery/recoveryNotifications.js';
import { runDailyArCloseAllPractices } from './jobs/dailyArClose.js';
import { sweepUpcomingAppointments } from './preVisit/appointmentIngest.js';

/**
 * Insurance operations tick: call queue priority, EMR outbox, payment trace recalls,
 * recovery alerts, daily AR close, and work-queue sync. Legacy patient Balance outreach
 * was removed — CollectRx is insurance-carrier recovery only.
 */
export async function runRulesEngineTick(prisma: PrismaClient): Promise<void> {
  try {
    const sync = await syncCallQueueSchedulingFromPriority(prisma);
    if (sync.rowsUpdated > 0) {
      console.log(
        `[rulesEngine] priority queue sync: ${sync.rowsUpdated} call_queue row(s), ${sync.practices} practice(s)`,
      );
    }
  } catch (err) {
    console.error('[rulesEngine] priority queue sync failed:', (err as Error).message);
  }

  try {
    const emr = await processEmrSyncOutboxBatch(prisma);
    if (emr.markedProcessed > 0 || emr.deliveryFailed > 0) {
      console.log(
        `[rulesEngine] EMR outbox: pulled ${emr.pulled}, processed ${emr.markedProcessed}, failed ${emr.deliveryFailed}`,
      );
    }
  } catch (err) {
    console.error('[rulesEngine] EMR outbox batch failed:', (err as Error).message);
  }

  try {
    const traced = await processPaymentTraceDue(prisma);
    if (traced > 0) {
      console.log(`[rulesEngine] payment trace recalls scheduled: ${traced}`);
    }
  } catch (err) {
    console.error('[rulesEngine] payment trace due failed:', (err as Error).message);
  }

  try {
    const overdueEscalated = await escalateOverdueRecoveryActions(prisma);
    if (overdueEscalated > 0) {
      console.log(`[rulesEngine] overdue practice actions escalated: ${overdueEscalated}`);
    }
  } catch (err) {
    console.error('[rulesEngine] overdue action sweep failed:', (err as Error).message);
  }

  const now = new Date();
  if (now.getUTCMinutes() === 0) {
    try {
      const practices = await prisma.practice.findMany({ select: { id: true } });
      for (const p of practices) {
        await syncWorkItemsForPractice(prisma, p.id);
        await dispatchRecoveryPracticeAlerts(prisma, p.id);
      }
    } catch (err) {
      console.error('[rulesEngine] hourly work queue / recovery alerts failed:', err);
    }
  }

  const closeHour = parseInt(process.env.AR_CLOSE_UTC_HOUR ?? '23', 10);
  if (now.getUTCHours() === closeHour && now.getUTCMinutes() < 2) {
    try {
      await runDailyArCloseAllPractices(prisma);
    } catch (err) {
      console.error('[rulesEngine] daily AR close failed:', (err as Error).message);
    }
  }

  // Pre-visit: sweep upcoming appointments once per hour at minute 5.
  if (now.getUTCMinutes() === 5) {
    try {
      const swept = await sweepUpcomingAppointments(prisma);
      if (swept > 0) {
        console.log(`[rulesEngine] pre-visit sweep verified ${swept} appointment(s)`);
      }
    } catch (err) {
      console.error('[rulesEngine] pre-visit appointment sweep failed:', (err as Error).message);
    }
  }
}

export function startRulesEngine(prisma: PrismaClient) {
  console.log('🤖 Insurance ops engine started — evaluating every 60 seconds (in-process)');

  // M-2: prevent concurrent ticks — if a tick takes longer than 60 seconds
  // (large EMR outbox batch, many practices), the next interval fires but
  // returns immediately rather than running syncWorkItems / outbox drain twice.
  let isRunning = false;

  const evaluateRules = async () => {
    if (isRunning) {
      console.warn('[rulesEngine] previous tick still running — skipping');
      return;
    }
    isRunning = true;
    try {
      await runRulesEngineTick(prisma);
    } catch (error) {
      console.error('❌ Rules engine error:', error);
    } finally {
      isRunning = false;
    }
  };

  void evaluateRules();
  setInterval(evaluateRules, 60000);
}
