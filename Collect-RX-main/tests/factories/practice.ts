import type { PracticeRole, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

/** Deterministic test password for factory-created practices/users (P7-04). */
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

/**
 * Create a practice plus a login-able user (email + password) for tests that exercise
 * the current email-based `/api/auth/login` flow. Returns the credentials to post.
 *
 * Cleanup: delete the user(s) before the practice (FK), e.g.
 *   await prisma.user.deleteMany({ where: { practiceId: practice.id } });
 *   await prisma.practice.delete({ where: { id: practice.id } });
 * or call `cleanupPracticeWithUsers`.
 */
export async function createPracticeWithOwnerForTests(
  prisma: PrismaClient,
  opts: { role?: PracticeRole } = {},
) {
  const practice = await createPracticeForTests(prisma);
  const passwordHash = await bcrypt.hash(FIXTURE_PRACTICE_PASSWORD, 4);
  const email = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@fixture.test`;
  const user = await prisma.user.create({
    data: {
      practiceId: practice.id,
      email,
      passwordHash,
      role: opts.role ?? 'practice_owner',
      displayName: 'Fixture User',
    },
  });
  return { practice, user, email, password: FIXTURE_PRACTICE_PASSWORD };
}

/**
 * Create a user in an existing practice, for tests that build the practice
 * themselves and just need a session to authenticate with.
 *
 * Sessions are re-confirmed against the User row on every request
 * (src/server/accessControl/sessionSubject.ts), so a token naming a user that
 * does not exist is rejected at authentication with 401 and never reaches the
 * route under test. Tests must therefore mint tokens for real rows.
 */
export async function createUserInPracticeForTests(
  prisma: PrismaClient,
  practiceId: string,
  role: PracticeRole = 'practice_owner',
) {
  const passwordHash = await bcrypt.hash(FIXTURE_PRACTICE_PASSWORD, 4);
  return prisma.user.create({
    data: {
      practiceId,
      email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@fixture.test`,
      passwordHash,
      role,
      displayName: `Fixture ${role}`,
    },
  });
}

/** Delete a practice and all its users, in FK-safe order. */
export async function cleanupPracticeWithUsers(prisma: PrismaClient, practiceId: string) {
  await prisma.user.deleteMany({ where: { practiceId } });
  await prisma.practice.delete({ where: { id: practiceId } }).catch(() => undefined);
}
