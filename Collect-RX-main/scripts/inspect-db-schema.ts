/**
 * Inspect the database schema vs Prisma — practice columns and migration history.
 * Usage: npx tsx scripts/inspect-db-schema.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const EXPECTED_PRACTICE_COLUMNS = [
  'subscriptionPriceId',
  'subscriptionPlanId',
  'subscriptionCurrentPeriodStart',
  'billingTier',
  'stripeSubscriptionItemId',
  'trialEndsAt',
  'callsPaused',
];

async function main() {
  const prisma = new PrismaClient();
  try {
    const cols = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Practice'
      ORDER BY column_name
    `;
    const names = new Set(cols.map((r) => r.column_name));
    const missing = EXPECTED_PRACTICE_COLUMNS.filter((c) => !names.has(c));

    const migTable = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_tables
        WHERE schemaname = 'public' AND tablename = '_prisma_migrations'
      ) AS exists
    `;
    let appliedCount = 0;
    if (migTable[0]?.exists) {
      const cnt = await prisma.$queryRaw<{ c: number }[]>`
        SELECT COUNT(*)::int AS c FROM _prisma_migrations
      `;
      appliedCount = cnt[0]?.c ?? 0;
    }

    console.log('Practice column count:', names.size);
    console.log('Missing expected columns:', missing.length ? missing.join(', ') : '(none)');
    console.log('_prisma_migrations applied count:', appliedCount);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
