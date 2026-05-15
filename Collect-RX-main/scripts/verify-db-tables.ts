/**
 * Smoke-check: required public tables exist and Prisma can query them.
 * Run: npm run db:verify-tables (from Collect-RX-main, DATABASE_URL in .env)
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const REQUIRED = [
  'insurance_claims',
  'call_attempts',
  'call_queue',
  'carrier_block_events',
  'eligibility_snapshots',
  'insurance_plans',
  'reconciliation_logs',
  'emr_sync_outbox',
] as const;

async function main() {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;
  const have = new Set(rows.map((r) => r.tablename));
  const missing = REQUIRED.filter((t) => !have.has(t));
  if (missing.length) {
    console.error('Missing tables:', missing.join(', '));
    console.error('Run: npx prisma migrate deploy');
    process.exit(1);
  }

  await prisma.insuranceClaim.findFirst({ take: 1 });
  await prisma.callAttempt.findFirst({ take: 1 });
  await prisma.callQueue.findFirst({ take: 1 });
  await prisma.carrierBlockEvent.findFirst({ take: 1 });
  await prisma.eligibilitySnapshot.findFirst({ take: 1 });
  await prisma.insurancePlan.findFirst({ take: 1 });
  await prisma.reconciliationLog.findFirst({ take: 1 });
  await prisma.emrSyncOutbox.findFirst({ take: 1 });

  console.log('db:verify-tables OK —', REQUIRED.length, 'critical tables present + Prisma queries succeed');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
