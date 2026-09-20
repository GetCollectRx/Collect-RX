import type { PrismaClient } from '@prisma/client';
import cron from 'node-cron';
import { runMarketingSequenceTick } from './sequenceEngine.js';
import {
  isMarketingLearningEnabled,
  marketingLearningCronExpression,
  runMarketingLearningCycle,
} from './marketingLearningJob.js';
import { runTrialOnboardingTick } from './trialOnboarding.js';
import { logger } from '../observability/logger.js';

let started = false;
let learningStarted = false;

/** In-process marketing cadence when BullMQ / Redis is unavailable. */
export function startMarketingLoopInProcess(prisma: PrismaClient): void {
  if (started) return;
  if (process.env.MARKETING_LOOP_ENABLED === '0') return;

  const pattern = (process.env.MARKETING_CRON || '0 * * * *').trim();
  if (!cron.validate(pattern)) {
    logger.error('[marketing] Invalid MARKETING_CRON', { pattern });
    return;
  }

  started = true;
  cron.schedule(pattern, () => {
    runMarketingSequenceTick(prisma).catch((err) => {
      logger.error('[marketing] tick failed', { error: err });
    });
    runTrialOnboardingTick(prisma).catch((err) => {
      logger.error('[trial-onboarding] tick failed', { error: err });
    });
  });
  logger.info('[marketing] In-process sequence tick scheduled', { pattern });
}

/** Weekly self-tuning score weights when BullMQ / Redis is unavailable. */
export function startMarketingLearningInProcess(prisma: PrismaClient): void {
  if (learningStarted) return;
  if (!isMarketingLearningEnabled()) return;
  if (process.env.MARKETING_LOOP_ENABLED === '0') return;

  const pattern = marketingLearningCronExpression();
  if (!cron.validate(pattern)) {
    logger.error('[marketing-learning] Invalid MARKETING_LEARNING_CRON', { pattern });
    return;
  }

  learningStarted = true;
  cron.schedule(pattern, () => {
    runMarketingLearningCycle(prisma).catch((err) => {
      logger.error('[marketing-learning] cycle failed', { error: err });
    });
  });
  logger.info('[marketing-learning] In-process cron scheduled', { pattern });
}
