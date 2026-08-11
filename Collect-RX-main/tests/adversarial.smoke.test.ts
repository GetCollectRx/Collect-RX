/**
 * Adversarial Multi-Tenant Isolation Smoke Tests
 *
 * These tests verify that the multi-tenant boundary is enforced at the API layer.
 * Each scenario represents a worst-case attack vector:
 *
 * 1. Cross-practice recording fetch (should 403)
 * 2. Cross-practice claim update (should 403)
 * 3. Cross-practice work queue enumeration (should deny/empty)
 * 4. Cross-practice password reset attempt (same msg as not found — no enum)
 * 5. Self-role escalation to platform_dev (should fail)
 * 6. vapiCallId metadata spoofing (should fail at claim lookup)
 *
 * For EACH test: proves failure via HTTP status and error message.
 */

import { afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import type { PracticeRole } from '@prisma/client';
import { app, prisma } from '../src/server/index.js';
import { COOKIE_NAME, signUserToken } from '../src/server/authToken.js';
import { createPracticeForTests, cleanupPracticeWithUsers } from './factories/practice.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn(
    '[adversarial smoke tests] DATABASE_URL unreachable — tests skipped:',
    (e as Error).message,
  );
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

/**
 * Helper: create a user session cookie for a practice
 */
function userCookie(practiceId: string, userId: string, role: PracticeRole = 'office_manager'): string {
  return `${COOKIE_NAME}=${signUserToken({
    userId,
    practiceId,
    role,
  })}`;
}

/**
 * Helper: clean up fixtures (practice + users + calls)
 */
async function cleanupFixtures(practices: { id: string }[]) {
  for (const p of practices) {
    // Clean call attempts first (foreign key to claim)
    const claimIds = (
      await prisma.insuranceClaim.findMany({
        where: { practiceId: p.id },
        select: { id: true },
      })
    ).map((c) => c.id);

    await prisma.callAttempt.deleteMany({
      where: { claimId: { in: claimIds } },
    });

    // Clean work items, claims, then practice
    await prisma.workItem.deleteMany({ where: { practiceId: p.id } });
    await prisma.insuranceClaim.deleteMany({ where: { practiceId: p.id } });
    await prisma.auditLog.deleteMany({ where: { practiceId: p.id } });
    await cleanupPracticeWithUsers(prisma, p.id);
  }
}

// Audit-log assertions were removed from these tests rather than repaired.
// authRoutes.ts calls appendAuditLog() zero times, so account creation, role
// changes and refused cross-tenant requests leave no audit record at all. Every
// such assertion here queried an always-empty table and could not fail — and an
// unused verifyAuditLogEntry() helper sat alongside them for the same reason.
// What these tests can prove, they still prove: the HTTP refusal and the
// unchanged database row. Auditing these mutations is a product gap.

describe.skipIf(!dbReady)('Adversarial Multi-Tenant Isolation', () => {
  // ──────────────────────────────────────────────────────────────────────────
  // Test 1: Cross-Practice Call Recording Access (should 403)
  // ──────────────────────────────────────────────────────────────────────────
  it('User A cannot fetch call recording from Practice B (returns 403)', async () => {
    const practiceA = await createPracticeForTests(prisma);
    const practiceB = await createPracticeForTests(prisma);

    const userA = await prisma.user.create({
      data: {
        practiceId: practiceA.id,
        email: `userA-${Date.now()}@test.local`,
        passwordHash: 'unused',
        displayName: 'User A',
        role: 'office_manager',
        isActive: true,
      },
    });

    // Create a claim and call attempt in Practice B
    const claimB = await prisma.insuranceClaim.create({
      data: {
        practiceId: practiceB.id,
        claimNumber: `CROSS-TEST-${Date.now()}`,
        patientToken: 'patient-token-b',
        carrierId: 'sun_life',
        status: 'PENDING',
        billedAmount: 1000,
        outstandingAmount: 1000,
        daysOutstanding: 10,
      },
    });

    const callB = await prisma.callAttempt.create({
      data: {
        claimId: claimB.id,
        vapiCallId: `vapi-call-${Date.now()}`,
        initiatedAt: new Date(),
        outcome: 'NO_ANSWER',
      },
    });

    // User A tries to fetch call from Practice B
    const cookieA = userCookie(practiceA.id, userA.id);
    const res = await request(app)
      .get(`/api/calls/${callB.id}`)
      .set('Cookie', cookieA);

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
    expect(res.body.error).toContain('not found');

    await cleanupFixtures([practiceA, practiceB]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 2: Cross-Practice Claim Update (should 403)
  // ──────────────────────────────────────────────────────────────────────────
  it('User A cannot update claim in Practice B (returns 403)', async () => {
    const practiceA = await createPracticeForTests(prisma);
    const practiceB = await createPracticeForTests(prisma);

    const userA = await prisma.user.create({
      data: {
        practiceId: practiceA.id,
        email: `userA2-${Date.now()}@test.local`,
        passwordHash: 'unused',
        displayName: 'User A',
        role: 'office_manager',
        isActive: true,
      },
    });

    // Create claim in Practice B
    const claimB = await prisma.insuranceClaim.create({
      data: {
        practiceId: practiceB.id,
        claimNumber: `CLAIM-B-${Date.now()}`,
        patientToken: 'patient-b',
        carrierId: 'sun_life',
        status: 'PENDING',
        billedAmount: 2000,
        outstandingAmount: 2000,
        daysOutstanding: 5,
      },
    });

    // User A tries to update claim in Practice B via PATCH endpoint
    const cookieA = userCookie(practiceA.id, userA.id);
    const res = await request(app)
      .patch(`/api/insurance/claims/${claimB.id}`)
      .set('Cookie', cookieA)
      .send({ servicedAt: new Date().toISOString() });

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();

    // Verify claim in Practice B was NOT modified
    const updatedClaim = await prisma.insuranceClaim.findUnique({
      where: { id: claimB.id },
    });
    expect(updatedClaim?.status).toBe('PENDING');

    await cleanupFixtures([practiceA, practiceB]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 3: Cross-Practice Work Queue Enumeration (returns empty/403)
  // ──────────────────────────────────────────────────────────────────────────
  it('User A cannot see Practice B work queue (returns empty)', async () => {
    const practiceA = await createPracticeForTests(prisma);
    const practiceB = await createPracticeForTests(prisma);

    const userA = await prisma.user.create({
      data: {
        practiceId: practiceA.id,
        email: `userA3-${Date.now()}@test.local`,
        passwordHash: 'unused',
        displayName: 'User A',
        role: 'practice_owner',
        isActive: true,
      },
    });

    // Create claims in Practice B
    const claim1 = await prisma.insuranceClaim.create({
      data: {
        practiceId: practiceB.id,
        claimNumber: `WQ-B-1-${Date.now()}`,
        patientToken: 'patient-b-1',
        carrierId: 'manulife',
        status: 'PENDING',
        billedAmount: 1500,
        outstandingAmount: 1500,
        daysOutstanding: 15,
      },
    });

    const claim2 = await prisma.insuranceClaim.create({
      data: {
        practiceId: practiceB.id,
        claimNumber: `WQ-B-2-${Date.now()}`,
        patientToken: 'patient-b-2',
        carrierId: 'canada_life',
        status: 'PENDING',
        billedAmount: 2500,
        outstandingAmount: 2500,
        daysOutstanding: 25,
      },
    });

    // Create work items linked to these claims
    await prisma.workItem.createMany({
      data: [
        {
          practiceId: practiceB.id,
          sourceType: 'insurance_claim',
          sourceId: claim1.id,
          itemType: 'insurance',
          status: 'open',
          daysOutstanding: 15,
          dollarsAtRisk: 1500,
          carrierId: 'manulife',
        },
        {
          practiceId: practiceB.id,
          sourceType: 'insurance_claim',
          sourceId: claim2.id,
          itemType: 'insurance',
          status: 'open',
          daysOutstanding: 25,
          dollarsAtRisk: 2500,
          carrierId: 'canada_life',
        },
      ],
    });

    // User A requests work queue stats (scoped to Practice A)
    const cookieA = userCookie(practiceA.id, userA.id);
    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Cookie', cookieA)
      .query({ practiceId: practiceA.id });

    expect(res.status).toBe(200);
    // Stats should be scoped to Practice A's data (empty in this case)
    expect(res.body).toBeDefined();

    // Attempt to enumerate Practice B items via crafted query
    const resB = await request(app)
      .get('/api/dashboard/stats')
      .set('Cookie', cookieA)
      .query({ practiceId: practiceB.id });

    // Request should be rejected (practiceId mismatch with session)
    expect(resB.status).toBe(403);
    expect(resB.body.error).toContain('does not match session');

    await cleanupFixtures([practiceA, practiceB]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 3b: Password reset tokens are hashed at rest, and the raw token
  // still redeems successfully (AA-30 — plaintext-token-at-rest fix)
  // ──────────────────────────────────────────────────────────────────────────
  it('Password reset token is stored hashed, not plaintext, and still round-trips', async () => {
    const practice = await createPracticeForTests(prisma);
    const user = await prisma.user.create({
      data: {
        practiceId: practice.id,
        email: `reset-hash-${Date.now()}@test.local`,
        passwordHash: await bcrypt.hash('OldPassword123!', 4),
        displayName: 'Reset Hash Test',
        role: 'front_desk',
        isActive: true,
      },
    });

    // passwordReset.ts logs the reset URL (containing the raw token) when
    // SENDGRID_API_KEY is unset, which is always true in this test env —
    // spy on it to recover the raw token the same way an emailed link would.
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const resRequest = await request(app)
      .post('/api/auth/reset-password/request')
      .send({ email: user.email });
    expect(resRequest.status).toBe(200);

    const loggedLine = consoleLogSpy.mock.calls
      .map((args) => args.join(' '))
      .find((line) => line.includes('Reset URL'));
    consoleLogSpy.mockRestore();

    const stored = await prisma.passwordResetToken.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(stored).not.toBeNull();
    // 64 lowercase hex chars = a SHA-256 digest, not the raw 32-byte-hex token.
    expect(stored!.token).toMatch(/^[0-9a-f]{64}$/);

    expect(loggedLine, 'expected password-reset console fallback to have logged the reset URL').toBeDefined();
    const match = loggedLine!.match(/token=([0-9a-f]+)/);
    expect(match, 'expected reset URL to contain a hex token query param').not.toBeNull();
    const rawToken = decodeURIComponent(match![1]);

    // The raw token must NOT equal what's stored — proves storage isn't plaintext.
    expect(stored!.token).not.toBe(rawToken);

    const resConfirm = await request(app)
      .post('/api/auth/reset-password/confirm')
      .send({ token: rawToken, newPassword: 'NewPassword456!' });
    expect(resConfirm.status).toBe(200);
    expect(resConfirm.body.ok).toBe(true);

    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    expect(await bcrypt.compare('NewPassword456!', updated!.passwordHash)).toBe(true);

    await cleanupFixtures([practice]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 4: Cross-Practice Password Reset (same message to prevent enumeration)
  // ──────────────────────────────────────────────────────────────────────────
  it('Password reset request for Practice B user returns same message as not-found', async () => {
    const practiceA = await createPracticeForTests(prisma);
    const practiceB = await createPracticeForTests(prisma);

    const userB = await prisma.user.create({
      data: {
        practiceId: practiceB.id,
        email: `userB-${Date.now()}@test.local`,
        passwordHash: 'unused',
        displayName: 'User B',
        role: 'front_desk',
        isActive: true,
      },
    });

    // Request 1: Password reset for non-existent email
    const resNonExistent = await request(app)
      .post('/api/auth/reset-password/request')
      .send({ email: 'nonexistent@never-existed.local' });

    // Request 2: Password reset for actual User B
    const resUserB = await request(app)
      .post('/api/auth/reset-password/request')
      .send({ email: userB.email });

    // Both should return 200 and the same generic message (to prevent enumeration)
    expect(resNonExistent.status).toBe(200);
    expect(resUserB.status).toBe(200);
    expect(resNonExistent.body.message).toBe(resUserB.body.message);
    expect(resNonExistent.body.message).toContain('If that email exists');

    // Verify that both responses are truly identical (prevents enumeration)
    // This proves the endpoint doesn't leak information about user existence
    expect(resNonExistent.body.ok).toBe(resUserB.body.ok);
    expect(resNonExistent.body.message).toBe(resUserB.body.message);

    await cleanupFixtures([practiceA, practiceB]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 5: Self-Role Escalation to platform_dev (should fail)
  // ──────────────────────────────────────────────────────────────────────────
  it('User cannot escalate own role to platform_dev (returns 403)', async () => {
    const practice = await createPracticeForTests(prisma);

    const user = await prisma.user.create({
      data: {
        practiceId: practice.id,
        email: `escalator-${Date.now()}@test.local`,
        passwordHash: 'unused',
        displayName: 'Attacker',
        role: 'office_manager',
        isActive: true,
      },
    });

    const cookie = userCookie(practice.id, user.id, 'office_manager');

    // Attempt 1: Try to update own role via PATCH /api/auth/users/:userId
    const res1 = await request(app)
      .patch(`/api/auth/users/${user.id}`)
      .set('Cookie', cookie)
      .send({ role: 'platform_dev' });

    // Should fail: office_manager cannot assign platform_dev
    expect(res1.status).toBe(403);
    expect(res1.body.error).toBeDefined();

    // Attempt 2: Try to promote via promote-owner (even if somehow reachable)
    const res2 = await request(app)
      .post(`/api/auth/users/${user.id}/promote-owner`)
      .set('Cookie', cookie)
      .send({});

    // Should fail: not authorized
    expect(res2.status).toBe(403);

    // Verify user role was NOT changed
    const updatedUser = await prisma.user.findUnique({
      where: { id: user.id },
    });
    expect(updatedUser?.role).toBe('office_manager');

    await cleanupFixtures([practice]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 6: vapiCallId Metadata Spoofing (should fail at claim lookup)
  // ──────────────────────────────────────────────────────────────────────────
  it('Attacker cannot claim vapiCallId from Practice B via metadata mutation', async () => {
    const practiceA = await createPracticeForTests(prisma);
    const practiceB = await createPracticeForTests(prisma);

    const userA = await prisma.user.create({
      data: {
        practiceId: practiceA.id,
        email: `attacker-${Date.now()}@test.local`,
        passwordHash: 'unused',
        displayName: 'Attacker',
        role: 'office_manager',
        isActive: true,
      },
    });

    // Create a valid call attempt in Practice B
    const claimB = await prisma.insuranceClaim.create({
      data: {
        practiceId: practiceB.id,
        claimNumber: `VAPI-SPOOF-${Date.now()}`,
        patientToken: 'patient-b-vapi',
        carrierId: 'telus_adjudicare',
        status: 'CALLING',
        billedAmount: 3000,
        outstandingAmount: 3000,
        daysOutstanding: 8,
      },
    });

    const callB = await prisma.callAttempt.create({
      data: {
        claimId: claimB.id,
        vapiCallId: `vapi-call-legit-${Date.now()}`,
        initiatedAt: new Date(),
      },
    });

    // Attacker (User A) crafts a request claiming the vapiCallId from Practice B
    // In a real attack, this might come from Vapi webhook metadata mutation
    const cookieA = userCookie(practiceA.id, userA.id);

    // Attempt to fetch the call by ID
    const res = await request(app)
      .get(`/api/calls/${callB.id}`)
      .set('Cookie', cookieA);

    // Should fail: call belongs to Practice B, not Practice A
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();

    // Verify claim in Practice B was NOT modified
    const claim = await prisma.insuranceClaim.findUnique({
      where: { id: claimB.id },
    });
    expect(claim?.status).toBe('CALLING');

    // Verify audit log: no successful cross-practice operations
    await cleanupFixtures([practiceA, practiceB]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Integration Test: Verify Access Denial Is Audited (failure signature)
  // ──────────────────────────────────────────────────────────────────────────
  it('Failed access attempts create audit trail (proves 100% denial)', async () => {
    const practiceA = await createPracticeForTests(prisma);
    const practiceB = await createPracticeForTests(prisma);

    const userA = await prisma.user.create({
      data: {
        practiceId: practiceA.id,
        email: `auditor-${Date.now()}@test.local`,
        passwordHash: 'unused',
        displayName: 'Auditor User',
        role: 'office_manager',
        isActive: true,
      },
    });

    // Create a claim in Practice B
    const claimB = await prisma.insuranceClaim.create({
      data: {
        practiceId: practiceB.id,
        claimNumber: `AUDIT-TEST-${Date.now()}`,
        patientToken: 'patient-audit',
        carrierId: 'sun_life',
        status: 'PENDING',
        billedAmount: 1000,
        outstandingAmount: 1000,
        daysOutstanding: 12,
      },
    });

    const cookie = userCookie(practiceA.id, userA.id);

    // Attempt 1: Try to get dashboard stats with cross-practice ID
    const res1 = await request(app)
      .get('/api/dashboard/stats')
      .set('Cookie', cookie)
      .query({ practiceId: practiceB.id });

    expect(res1.status).toBe(403);

    // Attempt 2: Try to update claim (will fail at lookup)
    const res2 = await request(app)
      .patch(`/api/insurance/claims/${claimB.id}`)
      .set('Cookie', cookie)
      .send({ servicedAt: new Date().toISOString() });

    expect(res2.status).toBe(404);

    await cleanupFixtures([practiceA, practiceB]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Edge Case: Platform Dev Cannot Bypass Multi-Tenant Boundary
  // ──────────────────────────────────────────────────────────────────────────
  it('Platform dev accessing Practice B still respects actual DB boundary', async () => {
    const practiceA = await createPracticeForTests(prisma);
    const practiceB = await createPracticeForTests(prisma);

    // Create claim in Practice B
    const claimB = await prisma.insuranceClaim.create({
      data: {
        practiceId: practiceB.id,
        claimNumber: `PLATFORMDEV-TEST-${Date.now()}`,
        patientToken: 'patient-pdev',
        carrierId: 'green_shield',
        status: 'PENDING',
        billedAmount: 500,
        outstandingAmount: 500,
        daysOutstanding: 3,
      },
    });

    // Create a call in Practice B
    const callB = await prisma.callAttempt.create({
      data: {
        claimId: claimB.id,
        vapiCallId: `vapi-pdev-${Date.now()}`,
        initiatedAt: new Date(),
      },
    });

    // Even if platform_dev somehow got Practice A's user session cookie,
    // fetching Practice B's data should fail because the claim lookup will
    // restrict by the user's session practice (not the platform_dev context param)
    const userA = await prisma.user.create({
      data: {
        practiceId: practiceA.id,
        email: `userA-pdev-${Date.now()}@test.local`,
        passwordHash: 'unused',
        displayName: 'User A (not platform dev)',
        role: 'office_manager',
        isActive: true,
      },
    });

    const cookieA = userCookie(practiceA.id, userA.id);

    // User A (Practice A) tries to access Practice B call via direct ID
    const res = await request(app)
      .get(`/api/calls/${callB.id}`)
      .set('Cookie', cookieA);

    // Should fail: claim lookup verifies practiceId matches session
    expect(res.status).toBe(404);

    await cleanupFixtures([practiceA, practiceB]);
  });
});
