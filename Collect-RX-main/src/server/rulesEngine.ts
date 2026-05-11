import { PrismaClient } from '@prisma/client';
import { generateMessageBody } from './messageTemplates.js';
import { syncCallQueueSchedulingFromPriority } from './services/priorityEngine.js';
import { processEmrSyncOutboxBatch } from './emrSyncOutbox.js';

/**
 * One evaluation pass (legacy `Balance` / `BalanceState` model). Safe to call from a worker on a schedule.
 * Also refreshes insurance `call_queue` ordering via the priority engine (no Redis required — same code path
 * whether jobs run in BullMQ worker or in-process `startRulesEngine`).
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

  const openBalances = await prisma.balance.findMany({
    where: { status: 'OPEN' },
    include: {
      patient: true,
      practice: true,
      states: {
        orderBy: { stageAt: 'desc' },
        take: 1,
      },
    },
  });

  for (const balance of openBalances) {
    const currentStage = balance.states[0]?.stage || 'CREATED';
    const stageAt = balance.states[0]?.stageAt || balance.createdAt;
    const daysSinceStage = Math.floor((Date.now() - stageAt.getTime()) / (1000 * 60 * 60 * 24));

    if (currentStage === 'CREATED') {
      await sendMessage(prisma, balance, 'NOTIFIED');
      await advanceStage(prisma, balance.id, 'NOTIFIED');
      console.log(`📨 Balance ${balance.id} → NOTIFIED`);
    } else if (currentStage === 'NOTIFIED' && daysSinceStage >= 5) {
      await sendMessage(prisma, balance, 'REMINDER_1');
      await advanceStage(prisma, balance.id, 'REMINDER_1');
      console.log(`📨 Balance ${balance.id} → REMINDER_1`);
    } else if (currentStage === 'REMINDER_1' && daysSinceStage >= 10) {
      await sendMessage(prisma, balance, 'REMINDER_2');
      await advanceStage(prisma, balance.id, 'REMINDER_2');
      console.log(`📨 Balance ${balance.id} → REMINDER_2`);
    } else if (
      currentStage === 'REMINDER_2' &&
      (daysSinceStage >= 20 || balance.amountCents >= 50000)
    ) {
      await sendMessage(prisma, balance, 'ESCALATED');
      await advanceStage(prisma, balance.id, 'ESCALATED');
      await advanceStage(prisma, balance.id, 'STAFF_REVIEW');
      console.log(`⚠️  Balance ${balance.id} → ESCALATED + STAFF_REVIEW`);
    }
  }
}

export function startRulesEngine(prisma: PrismaClient) {
  console.log('🤖 Rules engine started - evaluating every 60 seconds (in-process)');

  const evaluateRules = async () => {
    try {
      await runRulesEngineTick(prisma);
    } catch (error) {
      console.error('❌ Rules engine error:', error);
    }
  };

  void evaluateRules();
  setInterval(evaluateRules, 60000);
}

async function sendMessage(prisma: PrismaClient, balance: any, templateKey: string) {
  const messageBody = generateMessageBody(
    templateKey,
    balance.patient.displayName,
    balance.amountCents / 100,
    balance.id,
    Math.floor((Date.now() - balance.createdAt.getTime()) / (1000 * 60 * 60 * 24)),
    balance.practice.name
  );

  await prisma.outreachEvent.create({
    data: {
      balanceId: balance.id,
      channel: balance.patient.preferredChannel,
      templateKey,
      messageBody,
      deliveryStatus: 'SENT',
      responseStatus: 'NONE',
    },
  });
}

async function advanceStage(prisma: PrismaClient, balanceId: string, stage: string) {
  await prisma.balanceState.create({
    data: {
      balanceId,
      stage,
    },
  });
}
