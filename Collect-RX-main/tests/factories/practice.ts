import type { PracticeRole, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { runWithRlsBypass } from '../../src/server/db/rlsContext.js';

/** Deterministic test password for factory-created practices/users (P7-04). */
export const FIXTURE_PRACTICE_PASSWORD = 'test-factory-pw-e2e';

/**
 * Create a practice with a known password for API/integration tests.
 * Callers should `delete` the row in afterAll to avoid local DB cruft, or use a throwaway database.
 *
 * Explicit bypass, not the implicit VITEST-mode fallback in prismaRls.ts
 * (which only kicks in when no RLS context is set at all) — this factory
 * is called from dozens of test files with maxWorkers:1 (one shared
 * process for the whole suite), and relying on "nothing else happened to
 * set a context recently" is exactly the kind of implicit assumption that
 * caused real, hard-to-diagnose flakiness elsewhere in this codebase
 * today. Explicit is strictly safer here regardless.
 */
export async function createPracticeForTests(prisma: PrismaClient) {
  const passwordHash = await bcrypt.hash(FIXTURE_PRACTICE_PASSWORD, 4);
  return runWithRlsBypass(() =>
    prisma.practice.create({
      data: {
        name: `Fixture ${Date.now()}`,
        timezone: 'America/Toronto',
        passwordHash,
      },
    }),
  );
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
  const user = await runWithRlsBypass(() =>
    prisma.user.create({
      data: {
        practiceId: practice.id,
        email,
        passwordHash,
        role: opts.role ?? 'practice_owner',
        displayName: 'Fixture User',
      },
    }),
  );
  return { practice, user, email, password: FIXTURE_PRACTICE_PASSWORD };
}

/**
 * Add a real, DB-backed user to an existing practice for a given role — for tests
 * that need a token whose userId actually resolves in the DB. `authenticate()`
 * cross-checks a request's practiceId claim against `User.practiceId` on every
 * practice-scoped request, so a token minted for a userId with no matching row
 * (or a mismatched practiceId) is now correctly rejected with 401 — tests that
 * used synthetic, never-persisted userIds must create a real row instead.
 */
export async function createUserForTests(
  prisma: PrismaClient,
  practiceId: string,
  role: PracticeRole,
  overrides: { providerId?: string } = {},
) {
  const passwordHash = await bcrypt.hash(FIXTURE_PRACTICE_PASSWORD, 4);
  const email = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@fixture.test`;
  return runWithRlsBypass(() =>
    prisma.user.create({
      data: {
        practiceId,
        email,
        passwordHash,
        role,
        displayName: 'Fixture User',
        ...overrides,
      },
    }),
  );
}

/** Delete a practice and all its users, in FK-safe order. */
export async function cleanupPracticeWithUsers(prisma: PrismaClient, practiceId: string) {
  await runWithRlsBypass(async () => {
    await prisma.inviteToken.deleteMany({ where: { practiceId } });
    await prisma.user.deleteMany({ where: { practiceId } });
    await prisma.practice.delete({ where: { id: practiceId } }).catch(() => undefined);
  });
}
