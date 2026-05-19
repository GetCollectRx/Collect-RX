import cron from 'node-cron';
import type { PrismaClient } from '@prisma/client';
import { isLearningLoopEnabled, learningCronExpression } from './config.js';
import { runLearningCycle } from './cycle.js';

let inProcessScheduled = false;

export function startLearningLoopInProcess(prisma: PrismaClient): void {
  if (!isLearningLoopEnabled()) {
    console.log('[learning] LEARNING_LOOP_ENABLED off — in-process scheduler not started');
    return;
  }
  if (inProcessScheduled) return;

  const expression = learningCronExpression();
  if (!cron.validate(expression)) {
    console.error(`[learning] Invalid LEARNING_CRON "${expression}" — scheduler not started`);
    return;
  }

  cron.schedule(expression, () => {
    runLearningCycle(prisma).catch((err) =>
      console.error('[learning] cycle error:', (err as Error).message),
    );
  });

  inProcessScheduled = true;
  console.log(`[learning] In-process cron scheduled: "${expression}"`);
}
