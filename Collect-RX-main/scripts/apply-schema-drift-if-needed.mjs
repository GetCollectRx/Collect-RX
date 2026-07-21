#!/usr/bin/env node
/**
 * Apply schema-drift migration only when legacy patient-layer tables still exist.
 * Safe to run multiple times — skips when Patient table is already absent.
 *
 * Usage (from anywhere in the monorepo):
 *   npm run db:apply-schema-drift -w dental-ar-system
 *   cd Collect-RX-main && npm run db:apply-schema-drift
 */
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MIGRATION = join(ROOT, 'scripts/schema-drift-legacy-cleanup.sql');

/** Load .env from Collect-RX-main (not process.cwd — npm workspace cwd varies). */
function loadEnv() {
  const candidates = [
    join(ROOT, '.env'),
    join(ROOT, '.env.local'),
    join(ROOT, '..', '.env'),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const result = dotenv.config({ path });
    if (!result.error && process.env.DATABASE_URL?.trim()) {
      console.log(`[schema-drift] Loaded DATABASE_URL from ${path}`);
      return;
    }
  }
}

/** Managed Postgres URLs often omit sslmode; Prisma needs it for TLS. */
function ensureTls(url) {
  const trimmed = (url || '').trim();
  if (!trimmed.startsWith('postgres')) return trimmed;
  if (/[?&]sslmode=/.test(trimmed) || /[?&]ssl=true/.test(trimmed)) return trimmed;
  return `${trimmed}${trimmed.includes('?') ? '&' : '?'}sslmode=require`;
}

/**
 * @param {PrismaClient} prisma
 * @param {string} name
 */
async function tableExists(prisma, name) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
    name,
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function main() {
  loadEnv();

  let url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error('[schema-drift] DATABASE_URL is required.');
    console.error(`[schema-drift] Create ${join(ROOT, '.env')} with DATABASE_URL=postgresql://...`);
    console.error('[schema-drift] Or export DATABASE_URL before running this script.');
    process.exit(1);
  }

  url = ensureTls(url);
  process.env.DATABASE_URL = url;

  const prisma = new PrismaClient();
  try {
    const hasPatient = await tableExists(prisma, 'Patient');
    if (!hasPatient) {
      console.log('[schema-drift] Legacy Patient table not found — drift already resolved, nothing to do.');
      return;
    }

    console.warn('[schema-drift] Legacy patient-layer tables detected. Applying migration SQL…');
    console.warn('[schema-drift] Ensure you have a database backup before proceeding.');

    execSync(`npx prisma db execute --file "${MIGRATION}"`, {
      stdio: 'inherit',
      env: process.env,
      cwd: ROOT,
    });

    const stillHasPatient = await tableExists(prisma, 'Patient');
    if (stillHasPatient) {
      console.error('[schema-drift] Migration ran but Patient table still exists — verify migration SQL.');
      process.exit(1);
    }

    console.log('[schema-drift] Migration applied successfully.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[schema-drift] Failed:', err);
  process.exit(1);
});
