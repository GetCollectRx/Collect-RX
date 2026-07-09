/**
 * Playwright global setup: resolve (and optionally seed) E2E login credentials.
 *
 * Order of resolution:
 *   1. Honor explicit E2E_USER_EMAIL when set (must exist in DB).
 *   2. Use the first User in the DB (e.g. after `npm run db:seed`).
 *   3. If no users exist, create a disposable practice + owner for E2E only.
 *
 * Sets process.env.E2E_USER_EMAIL + E2E_USER_PASSWORD for the entire test run.
 * Only run against a local/disposable database — auto-seed uses a known password.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const DEFAULT_E2E_PRACTICE_ID = 'e2e-practice';
const DEFAULT_E2E_PRACTICE_NAME = 'CollectRx E2E Practice';
const DEFAULT_E2E_EMAIL = 'e2e@collectrx.test';
const DEFAULT_E2E_PASSWORD = 'changeme';

function resolvePassword(): string {
  return (
    process.env.E2E_USER_PASSWORD?.trim() ||
    process.env.E2E_PRACTICE_PASSWORD?.trim() ||
    DEFAULT_E2E_PASSWORD
  );
}

async function ensureE2EUser(prisma: PrismaClient): Promise<{ email: string; password: string }> {
  const password = resolvePassword();
  const explicitEmail = process.env.E2E_USER_EMAIL?.trim().toLowerCase();

  if (explicitEmail) {
    const user = await prisma.user.findUnique({ where: { email: explicitEmail } });
    if (!user) {
      throw new Error(`E2E_USER_EMAIL=${explicitEmail} not found — run db:seed or demo:seed first.`);
    }
    return { email: explicitEmail, password };
  }

  const existing = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (existing) {
    return { email: existing.email, password };
  }

  const passwordHash = await bcrypt.hash(DEFAULT_E2E_PASSWORD, 10);
  const practice =
    (await prisma.practice.findUnique({ where: { id: DEFAULT_E2E_PRACTICE_ID } })) ??
    (await prisma.practice.create({
      data: {
        id: DEFAULT_E2E_PRACTICE_ID,
        name: DEFAULT_E2E_PRACTICE_NAME,
        passwordHash,
      },
    }));

  await prisma.user.create({
    data: {
      practiceId: practice.id,
      email: DEFAULT_E2E_EMAIL,
      passwordHash,
      role: 'practice_owner',
      displayName: 'E2E Owner',
      isActive: true,
    },
  });

  return { email: DEFAULT_E2E_EMAIL, password: DEFAULT_E2E_PASSWORD };
}

export default async function globalSetup(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.warn(
      '[e2e] DATABASE_URL not set — skipping credential setup; login tests will be skipped.'
    );
    return;
  }

  const prisma = new PrismaClient();
  try {
    const { email, password } = await ensureE2EUser(prisma);
    process.env.E2E_USER_EMAIL = email;
    process.env.E2E_USER_PASSWORD = password;
    console.log(`[e2e] using E2E_USER_EMAIL=${email}`);
  } catch (err) {
    console.warn(
      `[e2e] credential setup failed (${(err as Error).message}); login tests will be skipped.`
    );
  } finally {
    await prisma.$disconnect();
  }
}
