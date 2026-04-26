import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

/** Deterministic test password for factory-created practices (P7-04). */
export const FIXTURE_PRACTICE_PASSWORD = 'test-factory-pw-e2e';

/**
 * Create a practice with a known password for API/integration tests.
 * Callers should `delete` the row in afterAll to avoid local DB cruft, or use a throwaway database.
 */
export async function createPracticeForTests(prisma: PrismaClient) {
  const passwordHash = await bcrypt.hash(FIXTURE_PRACTICE_PASSWORD, 4);
  return prisma.practice.create({
    data: {
      name: `Fixture ${Date.now()}`,
      timezone: 'America/Toronto',
      passwordHash,
    },
  });
}
