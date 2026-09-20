import cron from 'node-cron';
import type { PrismaClient } from '@prisma/client';
import { isLearningLoopEnabled, learningCronExpression } from './config.js';
import { runLearningCycle } from './cycle.js';
import { logger } from '../observability/logger.js';

let inProcessScheduled = false;

export function startLearningLoopInProcess(prisma: PrismaClient): void {
  if (!isLearningLoopEnabled()) {
    logger.info('[learning] LEARNING_LOOP_ENABLED off — in-process scheduler not started', {});
    return;
  }
  if (inProcessScheduled) return;

  const expression = learningCronExpression();
  if (!cron.validate(expression)) {
    logger.error('[learning] Invalid LEARNING_CRON — scheduler not started', { expression });
    return;
  }

  cron.schedule(expression, () => {
    runLearningCycle(prisma).catch((err) => logger.error('[learning] cycle error', { error: err }));
  });

  inProcessScheduled = true;
  logger.info('[learning] In-process cron scheduled', { expression });
}
