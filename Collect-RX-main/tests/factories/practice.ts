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
 * Delete a practice and everything that would otherwise block deleting it,
 * in FK-safe order. Many tests create InsuranceClaim rows (directly or via
 * dispatch/webhook flows) without deleting them explicitly — this used to
 * silently leave orphaned claims behind once `practice.delete()` succeeded,
 * since insurance_claims.practice_id had no FK to enforce otherwise (see
 * AA-05, docs/operations/AGENT-AUDIT-BACKLOG-2026-08-01.md). Now that the FK
 * exists, an unclean test would fail loudly here instead of leaking data.
 */
export async function cleanupPracticeWithUsers(prisma: PrismaClient, practiceId: string) {
  const claims = await prisma.insuranceClaim.findMany({
    where: { practiceId },
    select: { id: true },
  });
  const claimIds = claims.map((c) => c.id);
  if (claimIds.length > 0) {
    // call_attempts and call_queue are ON DELETE RESTRICT against
    // insurance_claims — must go first or the claim delete below fails.
    await prisma.callQueue.deleteMany({ where: { claimId: { in: claimIds } } });
    await prisma.callAttempt.deleteMany({ where: { claimId: { in: claimIds } } });
    await prisma.insuranceClaim.deleteMany({ where: { practiceId } });
  }
  await prisma.inviteToken.deleteMany({ where: { practiceId } });
  await prisma.user.deleteMany({ where: { practiceId } });
  await prisma.practice.delete({ where: { id: practiceId } }).catch(() => undefined);
}
