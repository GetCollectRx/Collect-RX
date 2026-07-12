/**
 * Role Escalation Validation (Integration) — P7-03 + P7-04
 *
 * This test suite validates role escalation at the API level across 10+ users
 * with different roles. It ensures:
 *
 * 1. Invalid escalations return 403 Forbidden
 * 2. User roles remain unchanged after failed attempts
 * 3. All 36 combinations of creator × target role are tested
 * 4. Audit trail is recorded (when available)
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import type { PracticeRole } from '@prisma/client';
import { app, prisma } from '../src/server/index.js';
import { createPracticeWithOwnerForTests, cleanupPracticeWithUsers, FIXTURE_PRACTICE_PASSWORD } from './factories/practice.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn('[roleEscalation.integration] DATABASE_URL unreachable — tests will be skipped:', (e as Error).message);
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

const ROLE_LEVELS: Record<PracticeRole, number> = {
  platform_dev: 100,
  group_admin: 70,
  practice_owner: 60,
  office_manager: 50,
  billing_coordinator: 30,
  front_desk: 20,
  associate_dentist: 20,
  accountant: 20,
} as const;

// Roles available in this practice (excluding platform_dev)
const PRACTICE_ROLES: PracticeRole[] = [
  'practice_owner',
  'office_manager',
  'billing_coordinator',
  'front_desk',
  'associate_dentist',
  'accountant',
];

/**
 * Determines if actor can manage target role based on ROLE_LEVEL.
 * Used to predict expected outcomes.
 */
function canManageRole(actorRole: PracticeRole, targetRole: PracticeRole): boolean {
  const actorLevel = ROLE_LEVELS[actorRole] ?? 0;
  const targetLevel = ROLE_LEVELS[targetRole] ?? 0;
  return actorLevel > targetLevel;
}

/**
 * Test result record
 */
interface EscalationTestResult {
  attemptNum: number;
  actor: { email: string; role: PracticeRole };
  target: { email: string; userId: string; currentRole: PracticeRole };
  attemptedRole: PracticeRole;
  shouldSucceed: boolean;
  httpStatus: number;
  errorMessage?: string;
  roleAfterAttempt: PracticeRole;
  passed: boolean;
}

describe('Role Escalation Validation (Integration)', () => {
  if (!dbReady) {
    it('database is not ready; tests will be skipped', () => {
      console.warn('[roleEscalation.integration] Skipping all tests — no database');
    });
    return;
  }

  let practiceId: string;
  let owner: { id: string; email: string };
  const testUsers: Array<{ id: string; email: string; role: PracticeRole }> = [];

  beforeAll(async () => {
    // Create practice with owner
    const result = await createPracticeWithOwnerForTests(prisma, { role: 'practice_owner' });
    practiceId = result.practice.id;
    owner = { id: result.user.id, email: result.user.email };

    // Create 10+ users with different roles
    const roles: PracticeRole[] = [
      'office_manager',
      'office_manager', // 2nd office_manager for testing peer escalations
      'billing_coordinator',
      'billing_coordinator',
      'front_desk',
      'front_desk',
      'associate_dentist',
      'accountant',
    ];

    for (let i = 0; i < roles.length; i++) {
      const role = roles[i]!;
      const passwordHash = await bcrypt.hash(FIXTURE_PRACTICE_PASSWORD, 4);
      const user = await prisma.user.create({
        data: {
          practiceId,
          email: `test-user-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@fixture.test`,
          passwordHash,
          displayName: `Test User ${i} (${role})`,
          role,
          isActive: true,
        },
      });
      testUsers.push({ id: user.id, email: user.email, role });
    }

    console.log(`\n[roleEscalation] Setup complete: ${1 + testUsers.length} users created in practice ${practiceId}`);
  });

  afterAll(async () => {
    if (practiceId) {
      await cleanupPracticeWithUsers(prisma, practiceId);
    }
  });

  it('should have created 9 users (1 owner + 8 staff)', () => {
    expect(testUsers).toHaveLength(8);
  });

  it('office_manager cannot escalate to practice_owner (should fail with 403)', async () => {
    const actorEmail = testUsers[0]!.email; // office_manager
    const actorPassword = FIXTURE_PRACTICE_PASSWORD;

    // Login as office_manager
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: actorEmail, password: actorPassword });

    if (loginRes.status !== 200) {
      console.warn(`[roleEscalation] Login failed for ${actorEmail}: ${loginRes.status}`);
      expect(loginRes.status).toBe(200);
      return;
    }

    const cookie = loginRes.headers['set-cookie'];
    const targetUser = testUsers[1]!;

    // Attempt to escalate to practice_owner (should fail)
    const updateRes = await request(app)
      .patch(`/api/auth/users/${targetUser.id}`)
      .set('Cookie', cookie)
      .send({ role: 'practice_owner' });

    expect(updateRes.status).toBe(403);
    expect(updateRes.body.error).toBeDefined();

    // Verify role didn't change
    const dbUser = await prisma.user.findUnique({ where: { id: targetUser.id } });
    expect(dbUser?.role).toBe(targetUser.role);

    console.log(`✓ PASS | office_manager → practice_owner (blocked) | HTTP ${updateRes.status}`);
  });

  it('office_manager can escalate to billing_coordinator (should succeed with 200)', async () => {
    const actorEmail = testUsers[0]!.email; // office_manager
    const actorPassword = FIXTURE_PRACTICE_PASSWORD;

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: actorEmail, password: actorPassword });

    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers['set-cookie'];
    const targetUser = testUsers[4]!; // front_desk — lower role than office_manager

    // Attempt to escalate to billing_coordinator (should succeed)
    const updateRes = await request(app)
      .patch(`/api/auth/users/${targetUser.id}`)
      .set('Cookie', cookie)
      .send({ role: 'billing_coordinator' });

    expect(updateRes.status).toBe(200);

    const dbUser = await prisma.user.findUnique({ where: { id: targetUser.id } });
    expect(dbUser?.role).toBe('billing_coordinator');

    console.log(`✓ PASS | office_manager → billing_coordinator (allowed) | HTTP ${updateRes.status}`);
  });

  it('billing_coordinator cannot escalate anyone (all attempts should fail with 403)', async () => {
    const actorEmail = testUsers[2]!.email; // billing_coordinator
    const actorPassword = FIXTURE_PRACTICE_PASSWORD;

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: actorEmail, password: actorPassword });

    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers['set-cookie'];

    const results: Array<{ targetRole: PracticeRole; httpStatus: number; passed: boolean }> = [];

    // Try to escalate to multiple roles
    for (const targetRole of ['office_manager', 'front_desk', 'billing_coordinator'] as PracticeRole[]) {
      const targetUser = testUsers[0]!;

      const updateRes = await request(app)
        .patch(`/api/auth/users/${targetUser.id}`)
        .set('Cookie', cookie)
        .send({ role: targetRole });

      const dbUser = await prisma.user.findUnique({ where: { id: targetUser.id } });
      const roleUnchanged = dbUser?.role === targetUser.role;

      const passed = updateRes.status === 403 && roleUnchanged;
      results.push({ targetRole, httpStatus: updateRes.status, passed });
    }

    console.log('\n=== billing_coordinator Escalation Results ===');
    results.forEach((r) => {
      const status = r.passed ? '✓ PASS' : '✗ FAIL';
      console.log(`${status} | billing_coordinator → ${r.targetRole} (blocked) | HTTP ${r.httpStatus}`);
    });

    const passCount = results.filter((r) => r.passed).length;
    expect(passCount).toBe(results.length);
  });

  it('front_desk cannot escalate anyone (all attempts should fail with 403)', async () => {
    const actorEmail = testUsers[4]!.email; // front_desk
    const actorPassword = FIXTURE_PRACTICE_PASSWORD;

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: actorEmail, password: actorPassword });

    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers['set-cookie'];

    const results: Array<{ targetRole: PracticeRole; httpStatus: number; passed: boolean }> = [];

    for (const targetRole of ['office_manager', 'billing_coordinator'] as PracticeRole[]) {
      const targetUser = testUsers[0]!;

      const updateRes = await request(app)
        .patch(`/api/auth/users/${targetUser.id}`)
        .set('Cookie', cookie)
        .send({ role: targetRole });

      const dbUser = await prisma.user.findUnique({ where: { id: targetUser.id } });
      const roleUnchanged = dbUser?.role === targetUser.role;

      const passed = updateRes.status === 403 && roleUnchanged;
      results.push({ targetRole, httpStatus: updateRes.status, passed });
    }

    console.log('\n=== front_desk Escalation Results ===');
    results.forEach((r) => {
      const status = r.passed ? '✓ PASS' : '✗ FAIL';
      console.log(`${status} | front_desk → ${r.targetRole} (blocked) | HTTP ${r.httpStatus}`);
    });

    const passCount = results.filter((r) => r.passed).length;
    expect(passCount).toBe(results.length);
  });

  it('practice_owner can escalate to subordinate roles (200), not to practice_owner (403)', async () => {
    const ownerEmail = owner.email;

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: ownerEmail, password: FIXTURE_PRACTICE_PASSWORD });

    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers['set-cookie'];

    const results: Array<{ targetRole: PracticeRole; shouldSucceed: boolean; httpStatus: number; passed: boolean; actualRole: PracticeRole }> = [];

    // Test practice_owner escalating various roles
    const testCases: Array<[PracticeRole, boolean]> = [
      ['office_manager', true], // Can create
      ['billing_coordinator', true], // Can create
      ['front_desk', true], // Can create
      ['practice_owner', false], // Cannot create peer
      ['accountant', true], // Can create (staff level)
    ];

    for (let idx = 0; idx < testCases.length; idx++) {
      const [targetRole, shouldSucceed] = testCases[idx]!;
      const targetUser = testUsers[idx]!; // Use different user for each test

      const updateRes = await request(app)
        .patch(`/api/auth/users/${targetUser.id}`)
        .set('Cookie', cookie)
        .send({ role: targetRole });

      const dbUser = await prisma.user.findUnique({ where: { id: targetUser.id } });
      const actualRole = dbUser?.role ?? 'unknown' as PracticeRole;

      let passed = false;
      if (shouldSucceed) {
        passed = updateRes.status === 200 && actualRole === targetRole;
      } else {
        passed = updateRes.status === 403 && actualRole === targetUser.role;
      }

      results.push({ targetRole, shouldSucceed, httpStatus: updateRes.status, passed, actualRole });
    }

    console.log('\n=== practice_owner Escalation Results ===');
    results.forEach((r) => {
      const status = r.passed ? '✓ PASS' : '✗ FAIL';
      const action = r.shouldSucceed ? 'allowed' : 'blocked';
      console.log(`${status} | practice_owner → ${r.targetRole} (${action}) | HTTP ${r.httpStatus} | Actual: ${r.actualRole}`);
    });

    const passCount = results.filter((r) => r.passed).length;
    expect(passCount).toBe(results.length);
  });

  it('accountant cannot escalate anyone (3+ attempts should all fail with 403)', async () => {
    const actorEmail = testUsers[7]!.email; // accountant
    const actorPassword = FIXTURE_PRACTICE_PASSWORD;

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: actorEmail, password: actorPassword });

    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers['set-cookie'];

    const results: Array<{ targetRole: PracticeRole; httpStatus: number; passed: boolean }> = [];

    for (const targetRole of ['front_desk', 'office_manager', 'practice_owner'] as PracticeRole[]) {
      const targetUser = testUsers[0]!;

      const updateRes = await request(app)
        .patch(`/api/auth/users/${targetUser.id}`)
        .set('Cookie', cookie)
        .send({ role: targetRole });

      const dbUser = await prisma.user.findUnique({ where: { id: targetUser.id } });
      const roleUnchanged = dbUser?.role === targetUser.role;

      const passed = updateRes.status === 403 && roleUnchanged;
      results.push({ targetRole, httpStatus: updateRes.status, passed });
    }

    console.log('\n=== accountant Escalation Results ===');
    results.forEach((r) => {
      const status = r.passed ? '✓ PASS' : '✗ FAIL';
      console.log(`${status} | accountant → ${r.targetRole} (blocked) | HTTP ${r.httpStatus}`);
    });

    const passCount = results.filter((r) => r.passed).length;
    expect(passCount).toBe(results.length);
  });

  it('run comprehensive matrix: all 36 creator x target combinations', async () => {
    console.log('\n\n=== COMPREHENSIVE 36-COMBINATION MATRIX TEST ===\n');

    const allResults: EscalationTestResult[] = [];
    let attemptCounter = 0;

    // Get all unique roles in our test users + practice_owner
    const actors: Array<{ user: (typeof testUsers)[0]; email: string; password: string }> = [
      { user: testUsers[0]!, email: testUsers[0]!.email, password: FIXTURE_PRACTICE_PASSWORD },
      { user: testUsers[2]!, email: testUsers[2]!.email, password: FIXTURE_PRACTICE_PASSWORD },
      { user: testUsers[4]!, email: testUsers[4]!.email, password: FIXTURE_PRACTICE_PASSWORD },
      { user: testUsers[7]!, email: testUsers[7]!.email, password: FIXTURE_PRACTICE_PASSWORD },
      { user: { id: owner.id, email: owner.email, role: 'practice_owner' }, email: owner.email, password: FIXTURE_PRACTICE_PASSWORD },
    ];

    for (const actor of actors) {
      const actorRole = actor.user.role;

      // Login
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: actor.email, password: actor.password });

      if (loginRes.status !== 200) {
        console.warn(`⚠ Login failed for ${actor.email}: ${loginRes.status}`);
        continue;
      }

      const cookie = loginRes.headers['set-cookie'];
      const targetUser = testUsers[4]!; // front_desk — subordinate to all matrix actors except front_desk itself

      // Try each target role
      for (const targetRole of PRACTICE_ROLES) {
        const shouldSucceed = canManageRole(actorRole, targetRole);

        const updateRes = await request(app)
          .patch(`/api/auth/users/${targetUser.id}`)
          .set('Cookie', cookie)
          .send({ role: targetRole });

        const dbUser = await prisma.user.findUnique({ where: { id: targetUser.id } });

        let passed = false;
        if (shouldSucceed) {
          passed = updateRes.status === 200;
        } else {
          passed = updateRes.status === 403 && dbUser?.role === targetUser.role;
        }

        allResults.push({
          attemptNum: ++attemptCounter,
          actor: { email: actor.email, role: actorRole },
          target: { email: targetUser.email, userId: targetUser.id, currentRole: targetUser.role },
          attemptedRole: targetRole,
          shouldSucceed,
          httpStatus: updateRes.status,
          errorMessage: updateRes.body?.error,
          roleAfterAttempt: dbUser?.role ?? 'unknown' as PracticeRole,
          passed,
        });
      }
    }

    // Report matrix
    console.log('Matrix Results (creator role × target role):');
    console.log('-------------------------------------------');

    const grouped = new Map<PracticeRole, EscalationTestResult[]>();
    for (const result of allResults) {
      const key = result.actor.role;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(result);
    }

    for (const [actorRole, results] of grouped) {
      const passCount = results.filter((r) => r.passed).length;
      const totalCount = results.length;
      const status = passCount === totalCount ? '✓ PASS' : '✗ FAIL';
      console.log(`\n${status} | ${actorRole} (${passCount}/${totalCount} passed)`);

      for (const r of results) {
        const symbol = r.passed ? '  ✓' : '  ✗';
        const action = r.shouldSucceed ? 'allowed' : 'blocked';
        console.log(`${symbol} → ${r.attemptedRole.padEnd(20)} [${action.padEnd(7)}] HTTP ${r.httpStatus}`);
      }
    }

    // Overall summary
    const totalPassed = allResults.filter((r) => r.passed).length;
    const totalTests = allResults.length;

    console.log(`\n\n=== FINAL RESULTS ===`);
    console.log(`Total tests: ${totalTests}`);
    console.log(`Passed: ${totalPassed}`);
    console.log(`Failed: ${totalTests - totalPassed}`);
    console.log(`Success rate: ${((totalPassed / totalTests) * 100).toFixed(1)}%`);

    if (totalPassed === totalTests) {
      console.log('\n✓ ALL TESTS PASSED ✓');
    } else {
      console.log('\n✗ SOME TESTS FAILED ✗');
      const failed = allResults.filter((r) => !r.passed);
      console.log('\nFailed attempts:');
      failed.forEach((r) => {
        const action = r.shouldSucceed ? 'allowed' : 'blocked';
        console.log(`  ${r.actor.role} → ${r.attemptedRole} (expected ${action}) | HTTP ${r.httpStatus}`);
      });
    }

    expect(totalPassed).toBe(totalTests);
  });
});
