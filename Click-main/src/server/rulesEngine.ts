import { PrismaClient } from '@prisma/client';
import { generateMessageBody } from './messageTemplates.js';

export function startRulesEngine(prisma: PrismaClient) {
  console.log('🤖 Rules engine started - evaluating every 60 seconds');

  const evaluateRules = async () => {
    try {
      // Get all open balances
      const openBalances = await prisma.balance.findMany({
        where: { status: 'OPEN' },
        include: {
          patient: true,
          states: {
            orderBy: { stageAt: 'desc' },
            take: 1
          }
        }
      });

      for (const balance of openBalances) {
        const currentStage = balance.states[0]?.stage || 'CREATED';
        const stageAt = balance.states[0]?.stageAt || balance.createdAt;
        const daysSinceStage = Math.floor((Date.now() - stageAt.getTime()) / (1000 * 60 * 60 * 24));

        // Rule 1: On BALANCE_CREATED, send NOTIFIED immediately
        if (currentStage === 'CREATED') {
          await sendMessage(prisma, balance, 'NOTIFIED');
          await advanceStage(prisma, balance.id, 'NOTIFIED');
          console.log(`📨 Balance ${balance.id} → NOTIFIED`);
        }

        // Rule 2: 5 days since NOTIFIED → REMINDER_1
        else if (currentStage === 'NOTIFIED' && daysSinceStage >= 5) {
          await sendMessage(prisma, balance, 'REMINDER_1');
          await advanceStage(prisma, balance.id, 'REMINDER_1');
          console.log(`📨 Balance ${balance.id} → REMINDER_1`);
        }

        // Rule 3: 10 days since REMINDER_1 → REMINDER_2
        else if (currentStage === 'REMINDER_1' && daysSinceStage >= 10) {
          await sendMessage(prisma, balance, 'REMINDER_2');
          await advanceStage(prisma, balance.id, 'REMINDER_2');
          console.log(`📨 Balance ${balance.id} → REMINDER_2`);
        }

        // Rule 4: 20 days since REMINDER_2 OR amount >= $500 → ESCALATED
        else if (
          currentStage === 'REMINDER_2' && 
          (daysSinceStage >= 20 || balance.amountCents >= 50000)
        ) {
          await sendMessage(prisma, balance, 'ESCALATED');
          await advanceStage(prisma, balance.id, 'ESCALATED');
          await advanceStage(prisma, balance.id, 'STAFF_REVIEW');
          console.log(`⚠️  Balance ${balance.id} → ESCALATED + STAFF_REVIEW`);
        }
      }
    } catch (error) {
      console.error('❌ Rules engine error:', error);
    }
  };

  // Run immediately, then every 60 seconds
  evaluateRules();
  setInterval(evaluateRules, 60000);
}

async function sendMessage(prisma: PrismaClient, balance: any, templateKey: string) {
  const messageBody = generateMessageBody(
    templateKey,
    balance.patient.displayName,
    balance.amountCents / 100,
    balance.id,
    Math.floor((Date.now() - balance.createdAt.getTime()) / (1000 * 60 * 60 * 24))
  );

  await prisma.outreachEvent.create({
    data: {
      balanceId: balance.id,
      channel: balance.patient.preferredChannel,
      templateKey,
      messageBody,
      deliveryStatus: 'SENT',
      responseStatus: 'NONE'
    }
  });
}

async function advanceStage(prisma: PrismaClient, balanceId: string, stage: string) {
  await prisma.balanceState.create({
    data: {
      balanceId,
      stage
    }
  });
}
