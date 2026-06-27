#!/usr/bin/env node
/**
 * Baseline Railway (or any pre-existing) PostgreSQL for Prisma Migrate.
 *
 * Problem: DB was built via manual SQL / db execute without _prisma_migrations history.
 * `prisma migrate deploy` fails with P3005; integration tests fail on schema drift.
 *
 * This script:
 *   1. Applies idempotent schema repairs (subscription columns, guardrails, etc.)
 *   2. Marks every migration in prisma/migrations as already applied (baseline)
 *   3. Runs `prisma migrate deploy` (should be no-op / only future migrations)
 *   4. Verifies Practice.subscriptionPriceId exists
 *
 * Usage (from Collect-RX-main, DATABASE_URL in .env):
 *   npm run db:baseline-railway
 *   npm run db:baseline-railway -- --dry-run
 */
import 'dotenv/config';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MIGRATIONS_DIR = join(ROOT, 'prisma/migrations');
const dryRun = process.argv.includes('--dry-run');

function run(cmd) {
  console.log(`\n$ ${cmd}`);
  if (!dryRun) {
    execSync(cmd, { stdio: 'inherit', cwd: ROOT, env: process.env });
  }
}

function listMigrationNames() {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

async function verifySubscriptionColumn(prisma) {
  const rows = await prisma.$queryRaw`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Practice'
      AND column_name = 'subscriptionPriceId'
  `;
  if (rows.length === 0) {
    throw new Error('Repair failed: Practice.subscriptionPriceId still missing');
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required in .env');
    process.exit(1);
  }

  console.log(dryRun ? '🔍 DRY RUN — no changes will be made' : '🚂 Baselining Railway Prisma migrations…');

  run('npx prisma db execute --file scripts/railway-schema-repair.sql');

  const migrations = listMigrationNames();
  console.log(`\nMarking ${migrations.length} migrations as applied…`);

  for (const name of migrations) {
    run(`npx prisma migrate resolve --applied "${name}"`);
  }

  run('npx prisma migrate deploy');
  run('npx prisma migrate status');

  if (!dryRun) {
    const prisma = new PrismaClient();
    try {
      await verifySubscriptionColumn(prisma);
      const practice = await prisma.practice.create({
        data: {
          name: `Baseline smoke ${Date.now()}`,
          timezone: 'America/Toronto',
          passwordHash: 'smoke-test-not-for-login',
        },
      });
      await prisma.practice.delete({ where: { id: practice.id } });
      console.log('\n✅ Baseline complete — Practice.create smoke test passed');
    } finally {
      await prisma.$disconnect();
    }
  } else {
    console.log('\n✅ Dry run complete — re-run without --dry-run to apply');
  }
}

main().catch((e) => {
  console.error('\n❌ Baseline failed:', e.message);
  process.exit(1);
});
