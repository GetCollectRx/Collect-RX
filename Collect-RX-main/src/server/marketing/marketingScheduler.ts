import type { PrismaClient } from '@prisma/client';
import cron from 'node-cron';
import { runMarketingSequenceTick } from './sequenceEngine.js';

let started = false;

/** In-process marketing cadence when BullMQ / Redis is unavailable. */
export function startMarketingLoopInProcess(prisma: PrismaClient): void {
  if (started) return;
  if (process.env.MARKETING_LOOP_ENABLED === '0') return;

  const pattern = (process.env.MARKETING_CRON || '0 * * * *').trim();
  if (!cron.validate(pattern)) {
    console.error(`[marketing] Invalid MARKETING_CRON "${pattern}"`);
    return;
  }

  started = true;
  cron.schedule(pattern, () => {
    runMarketingSequenceTick(prisma).catch((err) => {
      console.error('[marketing] tick failed', (err as Error).message);
    });
  });
  console.log(`[marketing] In-process sequence tick scheduled: ${pattern}`);
}
