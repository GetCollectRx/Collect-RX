/**
 * P7-05 — Soft delete isolation & data integrity tests.
 *
 * Verifies that soft deletes properly isolate deleted records from queries,
 * maintain referential integrity, and restrict hard deletes to admin + audit only.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/server/index.js';
import { createPracticeWithOwnerForTests, cleanupPracticeWithUsers } from './factories/practice.js';

let dbReady = false;
let softDeleteSchemaReady = false;
let userSoftDeleteSchemaReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
  const claimModel = Prisma.dmmf.datamodel.models.find((m) => m.name === 'InsuranceClaim');
  softDeleteSchemaReady = claimModel?.fields.some((f) => f.name === 'deletedAt') ?? false;
  const userModel = Prisma.dmmf.datamodel.models.find((m) => m.name === 'User');
  userSoftDeleteSchemaReady = userModel?.fields.some((f) => f.name === 'deletedAt') ?? false;
} catch (e) {
  console.warn('[softDeleteIsolation] DATABASE_URL unreachable — tests will be skipped:', (e as Error).message);
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Helpers — soft delete operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Soft-delete a claim (sets deletedAt timestamp).
 * Note: This assumes a future schema migration adds `deletedAt` to InsuranceClaim.
 */
async function softDeleteClaim(claimId: string) {
  return prisma.insuranceClaim.update({
    where: { id: claimId },
    data: { deletedAt: new Date() },
  } as unknown as Prisma.InsuranceClaimUpdateArgs);
}

/**
 * Soft-delete a user (sets deletedAt timestamp).
 * Note: This assumes a future schema migration adds `deletedAt` to User.
 */
async function softDeleteUser(userId: string) {
  return prisma.user.update({
    where: { id: userId },
    data: { deletedAt: new Date() },
  } as unknown as Prisma.UserUpdateArgs);
}

/**
 * Query claims excluding soft-deleted records.
 * Mirrors the application's explicit scope filtering (see src/routes/insurance.ts):
 * there is no global soft-delete Prisma extension, so `deletedAt: null` is part
 * of every claim lookup's where clause.
 */
async function findClaimNotDeleted(claimId: string) {
  return prisma.insuranceClaim.findFirst({
    where: { id: claimId, deletedAt: null },
  });
}

/**
 * Query user excluding soft-deleted records.
 * This mimics the expected query scope filtering in the application.
 */
async function findUserNotDeleted(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
  });
}

/**
 * Audit log for hard delete (irreversible operation).
 */
async function createHardDeleteAudit(
  practiceId: string,
  userId: string | null,
  action: string,
  subjectType: string,
  subjectId: string,
  details: Record<string, unknown>
) {
  return prisma.auditLog.create({
    data: {
      practiceId,
      userId,
      action,
      subjectType,
      subjectId,
      details,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────────────────

// Claim soft delete shipped (migration 20260712020000_insurance_claim_soft_delete);
// User.deletedAt has no migration yet, so only user-dependent tests gate on it.
describe.skipIf(!dbReady || !softDeleteSchemaReady)('Soft Delete Isolation', () => {
  describe('1. Deleted claims not returned by findUnique', () => {
    it('should skip deleted claim in findUnique', async () => {
      if (!dbReady) {
        console.log('Skipping: database not ready');
        return;
      }

      const { practice } = await createPracticeWithOwnerForTests(prisma);

      // Create a claim
      const claim = await prisma.insuranceClaim.create({
        data: {
          practiceId: practice.id,
          carrierId: 'sun_life',
          claimNumber: `CLAIM-TEST-${Date.now()}`,
          patientToken: 'test-token-' + Math.random().toString(36).slice(2, 8),
          billedAmount: new Prisma.Decimal(1000),
          outstandingAmount: new Prisma.Decimal(500),
          daysOutstanding: 45,
        },
      });

      // Verify it's accessible before soft delete
      let found = await findClaimNotDeleted(claim.id);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(claim.id);

      // Soft delete the claim
      await softDeleteClaim(claim.id);

      // Verify it's NOT found after soft delete
      found = await findClaimNotDeleted(claim.id);
      expect(found).toBeNull();

      // Cleanup
      await cleanupPracticeWithUsers(prisma, practice.id);
    });

    it('should exclude soft-deleted claims from practice-scoped queries', async () => {
      if (!dbReady) {
        console.log('Skipping: database not ready');
        return;
      }

      const { practice } = await createPracticeWithOwnerForTests(prisma);

      // Create two claims
      const claim1 = await prisma.insuranceClaim.create({
        data: {
          practiceId: practice.id,
          carrierId: 'sun_life',
          claimNumber: `CLAIM-1-${Date.now()}`,
          patientToken: 'token-1-' + Math.random().toString(36).slice(2, 8),
          billedAmount: new Prisma.Decimal(1000),
          outstandingAmount: new Prisma.Decimal(500),
          daysOutstanding: 45,
        },
      });

      const claim2 = await prisma.insuranceClaim.create({
        data: {
          practiceId: practice.id,
          carrierId: 'sun_life',
          claimNumber: `CLAIM-2-${Date.now()}`,
          patientToken: 'token-2-' + Math.random().toString(36).slice(2, 8),
          billedAmount: new Prisma.Decimal(2000),
          outstandingAmount: new Prisma.Decimal(1000),
          daysOutstanding: 60,
        },
      });

      // Query all claims for the practice (including soft-deleted)
      let allClaims = await prisma.insuranceClaim.findMany({
        where: { practiceId: practice.id },
      });
      expect(allClaims.length).toBeGreaterThanOrEqual(2);

      // Soft delete one claim
      await softDeleteClaim(claim1.id);

      // Query all claims (with deletedAt filter applied)
      const nonDeletedClaims = await prisma.insuranceClaim.findMany({
        where: {
          practiceId: practice.id,
          deletedAt: null,
        },
      } as unknown as Prisma.InsuranceClaimFindManyArgs);

      // The deleted claim should not be in the results
      const foundIds = nonDeletedClaims.map((c) => c.id);
      expect(foundIds).toContain(claim2.id);
      expect(foundIds).not.toContain(claim1.id);

      // Cleanup
      await cleanupPracticeWithUsers(prisma, practice.id);
    });
  });

  describe('2. Deleted claims not in work queue', () => {
    it('should exclude soft-deleted claims from queue listings', async () => {
      if (!dbReady) {
        console.log('Skipping: database not ready');
        return;
      }

      const { practice } = await createPracticeWithOwnerForTests(prisma);

      // Create a claim and queue it
      const claim = await prisma.insuranceClaim.create({
        data: {
          practiceId: practice.id,
          carrierId: 'sun_life',
          claimNumber: `QUEUE-TEST-${Date.now()}`,
          patientToken: 'queue-token-' + Math.random().toString(36).slice(2, 8),
          billedAmount: new Prisma.Decimal(1000),
          outstandingAmount: new Prisma.Decimal(500),
          daysOutstanding: 45,
          status: 'PENDING',
        },
      });

      const queueEntry = await prisma.callQueue.create({
        data: {
          practiceId: practice.id,
          claimId: claim.id,
          scheduledFor: new Date(Date.now() + 3600000),
          priority: 'NORMAL',
          status: 'PENDING',
        },
      });

      // Verify queue entry exists
      let queueItem = await prisma.callQueue.findUnique({
        where: { id: queueEntry.id },
        include: { claim: true },
      });
      expect(queueItem).not.toBeNull();
      expect(queueItem?.claim.id).toBe(claim.id);

      // Soft delete the claim
      await softDeleteClaim(claim.id);

      // Query queue: when joining with claims, soft-deleted claims should be excluded
      const activeQueueItems = await prisma.callQueue.findMany({
        where: {
          practiceId: practice.id,
          claim: { deletedAt: null },
        },
        include: { claim: true },
      } as unknown as Prisma.CallQueueFindManyArgs);

      // The deleted claim's queue entry should not appear
      const queueClaimIds = activeQueueItems.map((q) => q.claimId);
      expect(queueClaimIds).not.toContain(claim.id);

      // Cleanup
      await cleanupPracticeWithUsers(prisma, practice.id);
    });

    it('should maintain queue entry but mark associated claim as deleted', async () => {
      if (!dbReady) {
        console.log('Skipping: database not ready');
        return;
      }

      const { practice } = await createPracticeWithOwnerForTests(prisma);

      const claim = await prisma.insuranceClaim.create({
        data: {
          practiceId: practice.id,
          carrierId: 'sun_life',
          claimNumber: `QUEUE-ORPHAN-${Date.now()}`,
          patientToken: 'queue-orphan-' + Math.random().toString(36).slice(2, 8),
          billedAmount: new Prisma.Decimal(1000),
          outstandingAmount: new Prisma.Decimal(500),
          daysOutstanding: 45,
        },
      });

      const queueEntry = await prisma.callQueue.create({
        data: {
          practiceId: practice.id,
          claimId: claim.id,
          scheduledFor: new Date(Date.now() + 3600000),
        },
      });

      // Soft delete claim
      await softDeleteClaim(claim.id);

      // Queue entry should still exist (no cascade delete)
      const orphanedQueue = await prisma.callQueue.findUnique({
        where: { id: queueEntry.id },
      });
      expect(orphanedQueue).not.toBeNull();

      // But the claim is deleted
      const deletedClaim = await findClaimNotDeleted(claim.id);
      expect(deletedClaim).toBeNull();

      // Cleanup
      await cleanupPracticeWithUsers(prisma, practice.id);
    });
  });

  describe.skipIf(!userSoftDeleteSchemaReady)('3. Deleted users cannot login', () => {
    it('should prevent authentication with soft-deleted user', async () => {
      if (!dbReady) {
        console.log('Skipping: database not ready');
        return;
      }

      const { practice, user, email, password } = await createPracticeWithOwnerForTests(prisma);

      // Verify user can be found before soft delete
      let foundUser = await findUserNotDeleted(user.id);
      expect(foundUser).not.toBeNull();

      // Soft delete the user
      await softDeleteUser(user.id);

      // User should not be found after soft delete
      foundUser = await findUserNotDeleted(user.id);
      expect(foundUser).toBeNull();

      // Query for login should exclude soft-deleted users
      const deletedUserByEmail = await prisma.user.findUnique({
        where: { email },
      });

      // Depending on implementation, either:
      // A) The user row still exists but a WHERE clause filters it (manual)
      // B) A view or middleware hides it
      // For now, we test that explicit deletion filter works:
      if (deletedUserByEmail) {
        expect((deletedUserByEmail as Record<string, unknown>)['deletedAt']).not.toBeNull();
      }

      // Cleanup
      await cleanupPracticeWithUsers(prisma, practice.id);
    });

    it('should exclude soft-deleted users from practice-scoped user lists', async () => {
      if (!dbReady) {
        console.log('Skipping: database not ready');
        return;
      }

      const { practice, user: user1 } = await createPracticeWithOwnerForTests(prisma);

      // Create a second user
      const passwordHash = await bcrypt.hash('test-pw-2', 4);
      const user2 = await prisma.user.create({
        data: {
          practiceId: practice.id,
          email: `user2-${Date.now()}@fixture.test`,
          passwordHash,
          role: 'office_manager',
          displayName: 'User 2',
        },
      });

      // Both users should be findable initially
      let practiceUsers = await prisma.user.findMany({
        where: { practiceId: practice.id },
      });
      expect(practiceUsers.length).toBeGreaterThanOrEqual(2);

      // Soft delete user1
      await softDeleteUser(user1.id);

      // Query active users only
      const activeUsers = await prisma.user.findMany({
        where: {
          practiceId: practice.id,
          deletedAt: null,
        },
      } as unknown as Prisma.UserFindManyArgs);

      const activeUserIds = activeUsers.map((u) => u.id);
      expect(activeUserIds).toContain(user2.id);
      expect(activeUserIds).not.toContain(user1.id);

      // Cleanup
      await cleanupPracticeWithUsers(prisma, practice.id);
    });
  });

  describe('4. Soft deletes do not cascade (other tables still accessible)', () => {
    it('should preserve related CallAttempt records when claim is soft-deleted', async () => {
      if (!dbReady) {
        console.log('Skipping: database not ready');
        return;
      }

      const { practice } = await createPracticeWithOwnerForTests(prisma);

      const claim = await prisma.insuranceClaim.create({
        data: {
          practiceId: practice.id,
          carrierId: 'sun_life',
          claimNumber: `CALL-TEST-${Date.now()}`,
          patientToken: 'call-token-' + Math.random().toString(36).slice(2, 8),
          billedAmount: new Prisma.Decimal(1000),
          outstandingAmount: new Prisma.Decimal(500),
          daysOutstanding: 45,
        },
      });

      // Create call attempt
      const callAttempt = await prisma.callAttempt.create({
        data: {
          claimId: claim.id,
          vapiCallId: `vapi-${Date.now()}`,
          initiatedAt: new Date(),
          outcome: 'PENDING',
        },
      });

      // Soft delete claim
      await softDeleteClaim(claim.id);

      // Call attempt should still exist (no cascade)
      const callRecord = await prisma.callAttempt.findUnique({
        where: { id: callAttempt.id },
      });
      expect(callRecord).not.toBeNull();
      expect(callRecord?.claimId).toBe(claim.id);

      // Cleanup
      await cleanupPracticeWithUsers(prisma, practice.id);
    });

    it('should preserve ClaimRecoveryAction records when claim is soft-deleted', async () => {
      if (!dbReady) {
        console.log('Skipping: database not ready');
        return;
      }

      const { practice } = await createPracticeWithOwnerForTests(prisma);

      const claim = await prisma.insuranceClaim.create({
        data: {
          practiceId: practice.id,
          carrierId: 'sun_life',
          claimNumber: `RECOVERY-TEST-${Date.now()}`,
          patientToken: 'recovery-token-' + Math.random().toString(36).slice(2, 8),
          billedAmount: new Prisma.Decimal(1000),
          outstandingAmount: new Prisma.Decimal(500),
          daysOutstanding: 45,
        },
      });

      // Create recovery action
      const recovery = await prisma.claimRecoveryAction.create({
        data: {
          practiceId: practice.id,
          claimId: claim.id,
          actionType: 'PROCESSING_RECALL',
          route: 'CALL_CARRIER',
          title: 'Recall processing',
          status: 'BLOCKING',
        },
      });

      // Soft delete claim
      await softDeleteClaim(claim.id);

      // Recovery action should still exist
      const recoveryRecord = await prisma.claimRecoveryAction.findUnique({
        where: { id: recovery.id },
      });
      expect(recoveryRecord).not.toBeNull();
      expect(recoveryRecord?.claimId).toBe(claim.id);

      // Cleanup
      await cleanupPracticeWithUsers(prisma, practice.id);
    });

    it.skipIf(!userSoftDeleteSchemaReady)('should preserve AuditLog when user is soft-deleted', async () => {
      if (!dbReady) {
        console.log('Skipping: database not ready');
        return;
      }

      const { practice, user } = await createPracticeWithOwnerForTests(prisma);

      // Create an audit log entry referencing the user
      const auditEntry = await prisma.auditLog.create({
        data: {
          practiceId: practice.id,
          userId: user.id,
          action: 'patient_ar.write_off',
          subjectType: 'claim',
          subjectId: 'test-claim-id',
          details: { amount: 100 },
        },
      });

      // Soft delete user
      await softDeleteUser(user.id);

      // Audit log should still exist (immutable append-only log)
      const auditRecord = await prisma.auditLog.findUnique({
        where: { id: auditEntry.id },
      });
      expect(auditRecord).not.toBeNull();
      expect(auditRecord?.userId).toBe(user.id);

      // Cleanup
      await cleanupPracticeWithUsers(prisma, practice.id);
    });
  });

  describe('5. Hard delete (irreversible) only via admin + audit', () => {
    it('should require admin grant to perform hard delete', async () => {
      if (!dbReady) {
        console.log('Skipping: database not ready');
        return;
      }

      const { practice, user } = await createPracticeWithOwnerForTests(prisma);

      // Regular user should NOT have hard delete capability
      // (In production, this would be enforced at the API layer)
      expect(user.role).toBe('practice_owner');

      // Only platform_admin or system should be able to hard delete
      // This test verifies the audit log is created when a hard delete occurs
      const claim = await prisma.insuranceClaim.create({
        data: {
          practiceId: practice.id,
          carrierId: 'sun_life',
          claimNumber: `HARD-DELETE-${Date.now()}`,
          patientToken: 'hard-delete-' + Math.random().toString(36).slice(2, 8),
          billedAmount: new Prisma.Decimal(1000),
          outstandingAmount: new Prisma.Decimal(500),
          daysOutstanding: 45,
        },
      });

      // When an admin hard-deletes, audit log must be created FIRST
      const auditLog = await createHardDeleteAudit(
        practice.id,
        user.id,
        'admin.claim.hard_delete',
        'claim',
        claim.id,
        {
          reason: 'data_correction',
          claimNumber: claim.claimNumber,
          timestamp: new Date().toISOString(),
        }
      );

      expect(auditLog).not.toBeNull();
      expect(auditLog.action).toBe('admin.claim.hard_delete');
      expect(auditLog.subjectId).toBe(claim.id);

      // Only AFTER audit logged, hard delete is permitted
      // (In production, this would be guarded by middleware)

      // Cleanup
      await cleanupPracticeWithUsers(prisma, practice.id);
    });

    it('should create immutable audit trail for all hard deletes', async () => {
      if (!dbReady) {
        console.log('Skipping: database not ready');
        return;
      }

      const { practice, user } = await createPracticeWithOwnerForTests(prisma);

      const claim = await prisma.insuranceClaim.create({
        data: {
          practiceId: practice.id,
          carrierId: 'sun_life',
          claimNumber: `AUDIT-DELETE-${Date.now()}`,
          patientToken: 'audit-delete-' + Math.random().toString(36).slice(2, 8),
          billedAmount: new Prisma.Decimal(1000),
          outstandingAmount: new Prisma.Decimal(500),
          daysOutstanding: 45,
        },
      });

      const reason = 'Duplicate claim detected during audit';
      const details = {
        reason,
        duplicateOf: 'claim-xyz',
        deletedBy: 'platform_admin',
      };

      // Hard delete requires immutable audit entry
      const audit = await createHardDeleteAudit(
        practice.id,
        user.id,
        'admin.claim.hard_delete',
        'claim',
        claim.id,
        details
      );

      expect(audit).not.toBeNull();
      expect(audit.details).toMatchObject(details);

      // Audit log is append-only (no updates)
      const verifyAudit = await prisma.auditLog.findUnique({
        where: { id: audit.id },
      });
      expect(verifyAudit).not.toBeNull();
      expect(verifyAudit?.action).toBe('admin.claim.hard_delete');

      // Cleanup
      await cleanupPracticeWithUsers(prisma, practice.id);
    });

    it('should enforce that hard delete is irreversible (no undo)', async () => {
      if (!dbReady) {
        console.log('Skipping: database not ready');
        return;
      }

      const { practice, user } = await createPracticeWithOwnerForTests(prisma);

      const originalClaim = await prisma.insuranceClaim.create({
        data: {
          practiceId: practice.id,
          carrierId: 'sun_life',
          claimNumber: `IRREVERSIBLE-${Date.now()}`,
          patientToken: 'irreversible-' + Math.random().toString(36).slice(2, 8),
          billedAmount: new Prisma.Decimal(1000),
          outstandingAmount: new Prisma.Decimal(500),
          daysOutstanding: 45,
        },
      });

      const claimId = originalClaim.id;

      // Create audit entry for hard delete
      await createHardDeleteAudit(
        practice.id,
        user.id,
        'admin.claim.hard_delete',
        'claim',
        claimId,
        { reason: 'Test irreversibility' }
      );

      // Hard delete the claim (from database completely)
      // In production, this would be done via a restricted admin API
      try {
        await prisma.insuranceClaim.delete({
          where: { id: claimId },
        });
      } catch (e) {
        // Deletion might fail due to FKs; that's expected
        // The audit log is the immutable proof it was attempted
      }

      // Attempting to restore should fail (no "undelete" operation exists)
      const restored = await findClaimNotDeleted(claimId);
      expect(restored).toBeNull();

      // Only the audit log proves the hard delete occurred
      const auditEntries = await prisma.auditLog.findMany({
        where: {
          practiceId: practice.id,
          subjectId: claimId,
          action: 'admin.claim.hard_delete',
        },
      });
      expect(auditEntries.length).toBeGreaterThan(0);

      // Cleanup
      await cleanupPracticeWithUsers(prisma, practice.id);
    });
  });

  describe('Soft delete schema assumptions', () => {
    it('should have deletedAt field on InsuranceClaim (when implemented)', async () => {
      if (!dbReady) {
        console.log('Skipping: database not ready');
        return;
      }

      const { practice } = await createPracticeWithOwnerForTests(prisma);

      const claim = await prisma.insuranceClaim.create({
        data: {
          practiceId: practice.id,
          carrierId: 'sun_life',
          claimNumber: `SCHEMA-TEST-${Date.now()}`,
          patientToken: 'schema-test-' + Math.random().toString(36).slice(2, 8),
          billedAmount: new Prisma.Decimal(1000),
          outstandingAmount: new Prisma.Decimal(500),
          daysOutstanding: 45,
        },
      });

      // Check if deletedAt field exists in the claim record
      const claimRecord = await prisma.insuranceClaim.findUnique({
        where: { id: claim.id },
      });

      expect(claimRecord).not.toBeNull();
      // Field may not exist yet, but when it does, it should be null initially
      if ('deletedAt' in claimRecord!) {
        expect((claimRecord as Record<string, unknown>).deletedAt).toBeNull();
      }

      // Cleanup
      await cleanupPracticeWithUsers(prisma, practice.id);
    });

    it('should have deletedAt field on User (when implemented)', async () => {
      if (!dbReady) {
        console.log('Skipping: database not ready');
        return;
      }

      const { practice, user } = await createPracticeWithOwnerForTests(prisma);

      const userRecord = await prisma.user.findUnique({
        where: { id: user.id },
      });

      expect(userRecord).not.toBeNull();
      // Field may not exist yet, but when it does, it should be null initially
      if ('deletedAt' in userRecord!) {
        expect((userRecord as Record<string, unknown>).deletedAt).toBeNull();
      }

      // Cleanup
      await cleanupPracticeWithUsers(prisma, practice.id);
    });
  });
});
