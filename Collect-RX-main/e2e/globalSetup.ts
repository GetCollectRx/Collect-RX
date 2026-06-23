/**
 * Playwright global setup: auto-discover (and seed) E2E_PRACTICE_ID so tests
 * stop being skipped when the env var isn't pre-set.
 *
 * Order of resolution:
 *   1. Honor an explicit E2E_PRACTICE_ID if already in env.
 *   2. Look up the first Practice in the DB (matching scripts/print-e2e-practice-id.ts).
 *   3. If none exists, seed one with id 'e2e-practice' and password 'changeme' and use it.
 *
 * Sets process.env.E2E_PRACTICE_ID + E2E_PRACTICE_PASSWORD for the entire test run.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const DEFAULT_E2E_PRACTICE_ID = 'e2e-practice';
const DEFAULT_E2E_PRACTICE_NAME = 'CollectRx E2E Practice';
const DEFAULT_E2E_PASSWORD = 'changeme';

async function ensurePractice(prisma: PrismaClient): Promise<string> {
  if (process.env.E2E_PRACTICE_ID) {
    return process.env.E2E_PRACTICE_ID;
  }
  const existing = await prisma.practice.findFirst({ orderBy: { name: 'asc' } });
  if (existing) return existing.id;

  const passwordHash = await bcrypt.hash(DEFAULT_E2E_PASSWORD, 10);
  const created = await prisma.practice.create({
    data: {
      id: DEFAULT_E2E_PRACTICE_ID,
      name: DEFAULT_E2E_PRACTICE_NAME,
      passwordHash,
    },
  });
  return created.id;
}

export default async function globalSetup(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.warn(
      '[e2e] DATABASE_URL not set — skipping E2E_PRACTICE_ID auto-seed; tests requiring it will be skipped.'
    );
    return;
  }
  const prisma = new PrismaClient();
  try {
    const id = await ensurePractice(prisma);
    process.env.E2E_PRACTICE_ID = id;
    if (!process.env.E2E_PRACTICE_PASSWORD) {
      process.env.E2E_PRACTICE_PASSWORD = DEFAULT_E2E_PASSWORD;
    }
    console.log(`[e2e] using E2E_PRACTICE_ID=${id}`);
  } catch (err) {
    console.warn(
      `[e2e] auto-seed failed (${(err as Error).message}); tests requiring E2E_PRACTICE_ID will be skipped.`
    );
  } finally {
    await prisma.$disconnect();
  }
}
