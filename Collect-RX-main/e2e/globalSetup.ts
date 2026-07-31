/**
 * Playwright global setup: auto-discover (and seed) the e2e practice and owner
 * user so tests stop being skipped when the env vars aren't pre-set.
 *
 * Order of resolution:
 *   1. Honor explicit E2E_PRACTICE_ID / E2E_USER_EMAIL if already in env.
 *   2. Use the dedicated 'e2e-practice' row and 'e2e-owner@collectrx.test'
 *      user, creating them with password 'changeme' if missing. Other
 *      practices (demo seed, integration-test residue) are never picked up —
 *      their passwords are not 'changeme', so login would fail.
 *
 * Sets E2E_PRACTICE_ID, E2E_PRACTICE_PASSWORD, E2E_USER_EMAIL, and
 * E2E_USER_PASSWORD for the entire test run.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const DEFAULT_E2E_PRACTICE_ID = 'e2e-practice';
const DEFAULT_E2E_PRACTICE_NAME = 'CollectRx E2E Practice';
const DEFAULT_E2E_USER_EMAIL = 'e2e-owner@collectrx.test';
const DEFAULT_E2E_PASSWORD = 'changeme';

async function ensurePractice(prisma: PrismaClient): Promise<string> {
  if (process.env.E2E_PRACTICE_ID) {
    return process.env.E2E_PRACTICE_ID;
  }
  const existing = await prisma.practice.findUnique({
    where: { id: DEFAULT_E2E_PRACTICE_ID },
  });
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

async function ensureOwnerUser(prisma: PrismaClient, practiceId: string): Promise<string> {
  if (process.env.E2E_USER_EMAIL) {
    return process.env.E2E_USER_EMAIL;
  }
  const passwordHash = await bcrypt.hash(DEFAULT_E2E_PASSWORD, 10);
  await prisma.user.upsert({
    where: { email: DEFAULT_E2E_USER_EMAIL },
    update: { practiceId, passwordHash, role: 'practice_owner', isActive: true },
    create: {
      practiceId,
      email: DEFAULT_E2E_USER_EMAIL,
      passwordHash,
      role: 'practice_owner',
      displayName: 'E2E Owner',
    },
  });
  return DEFAULT_E2E_USER_EMAIL;
}

export default async function globalSetup(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.warn(
      '[e2e] DATABASE_URL not set — skipping E2E auto-seed; tests requiring it will be skipped.'
    );
    return;
  }
  const prisma = new PrismaClient();
  try {
    const id = await ensurePractice(prisma);
    const email = await ensureOwnerUser(prisma, id);
    process.env.E2E_PRACTICE_ID = id;
    process.env.E2E_USER_EMAIL = email;
    if (!process.env.E2E_PRACTICE_PASSWORD) {
      process.env.E2E_PRACTICE_PASSWORD = DEFAULT_E2E_PASSWORD;
    }
    if (!process.env.E2E_USER_PASSWORD) {
      process.env.E2E_USER_PASSWORD = DEFAULT_E2E_PASSWORD;
    }
    console.log(`[e2e] using E2E_PRACTICE_ID=${id}, E2E_USER_EMAIL=${email}`);
  } catch (err) {
    console.warn(
      `[e2e] auto-seed failed (${(err as Error).message}); tests requiring E2E_PRACTICE_ID will be skipped.`
    );
  } finally {
    await prisma.$disconnect();
  }
}
