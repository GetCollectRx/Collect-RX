/**
 * Run one Phase 6 learning cycle without BullMQ (no REDIS_URL required).
 * Usage: LEARNING_LOOP_ENABLED=1 npm run learning:cycle
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { runLearningCycle } from '../src/server/learning/cycle.js';
import { isLearningLoopEnabled } from '../src/server/learning/config.js';

async function main() {
  if (!isLearningLoopEnabled()) {
    console.error(
      'Set LEARNING_LOOP_ENABLED=1 and Notion vars (NOTION_API_KEY, NOTION_LEARNING_DATABASE_ID).',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const summary = await runLearningCycle(prisma);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[learning:cycle]', (err as Error).message);
  process.exit(1);
});
