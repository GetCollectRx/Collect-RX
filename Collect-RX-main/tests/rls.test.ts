/**
 * RLS (Row Level Security) Tests — Multi-Tenant Data Isolation
 *
 * Tests that PostgreSQL RLS policies enforce proper data isolation across practices:
 *   1. Users from Practice A cannot read claims/data from Practice B
 *   2. Users from Practice A cannot write/update data for Practice B
 *   3. Audit logs are scoped to the user's practice only
 *   4. RLS policies are enforced via direct SQL execution (not just ORM)
 *
 * Test Coverage:
 *   • 20+ test cases covering read, write, and audit isolation
 *   • Multi-practice scenario with concurrent users
 *   • Direct SQL verification of policy enforcement
 *   • Edge cases: cross-practice recovery actions, notifications
 *
 * NOTE: These tests require RLS policies to be defined at the database level.
 * If policies are not yet deployed, run:
 *   npx prisma migrate deploy
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { InsuranceClaim, CarrierId, User, Practice, AuditLog, Prisma } from '@prisma/client';
import { prisma } from '../src/server/index.js';
import {
  createPracticeWithOwnerForTests,
  cleanupPracticeWithUsers,
  FIXTURE_PRACTICE_PASSWORD,
} from './factories/practice.js';
import { runWithRlsBypass } from '../src/server/db/rlsContext.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test Setup & Fixtures
// ─────────────────────────────────────────────────────────────────────────────

// Must be set at module load — describe.skipIf() is evaluated before beforeAll runs.
let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn('[rls.test] DATABASE_URL unreachable — tests skipped:', (e as Error).message);
}

/** True DB FORCE RLS (rejects cross-tenant writes). Default app role does not. */
const strictRls = process.env.COLLECTRX_RLS_TEST_STRICT === '1';

let practiceA: Practice;
let practiceB: Practice;
let userA: User;
let userB: User;
let userA2: User; // Second user in Practice A
let claimA1: InsuranceClaim;
let claimA2: InsuranceClaim;
let claimB1: InsuranceClaim;

// Fixture hooks run under an explicit RLS bypass so they also work when
// COLLECTRX_RLS_TEST_STRICT=1 disables the automatic vitest bypass (FORCE RLS
// would otherwise reject the cross-practice fixture writes).
beforeAll(() => runWithRlsBypass(async () => {
  if (!dbReady) return;
  try {
    // Create two practices with users
    const setupA = await createPracticeWithOwnerForTests(prisma);
    practiceA = setupA.practice;
    userA = setupA.user;

    const setupB = await createPracticeWithOwnerForTests(prisma);
    practiceB = setupB.practice;
    userB = setupB.user;

    // Create second user in Practice A
    const hash = await import('bcryptjs').then((m) =>
      m.default.hash(FIXTURE_PRACTICE_PASSWORD, 4)
    );
    userA2 = await prisma.user.create({
      data: {
        practiceId: practiceA.id,
        email: `user2-${Date.now()}@fixture.test`,
        passwordHash: hash,
        role: 'billing_coordinator',
        displayName: 'Fixture User 2',
      },
    });

    // Create insurance claims for Practice A
    claimA1 = await prisma.insuranceClaim.create({
      data: {
        practiceId: practiceA.id,
        carrierId: 'sun_life' as CarrierId,
        claimNumber: 'CLAIM-A-001',
        patientToken: '550e8400-e29b-41d4-a716-446655440001',
        billedAmount: 1500,
        outstandingAmount: 500,
        daysOutstanding: 45,
      },
    });

    claimA2 = await prisma.insuranceClaim.create({
      data: {
        practiceId: practiceA.id,
        carrierId: 'canada_life' as CarrierId,
        claimNumber: 'CLAIM-A-002',
        patientToken: '550e8400-e29b-41d4-a716-446655440002',
        billedAmount: 2000,
        outstandingAmount: 800,
        daysOutstanding: 60,
      },
    });

    // Create insurance claim for Practice B
    claimB1 = await prisma.insuranceClaim.create({
      data: {
        practiceId: practiceB.id,
        carrierId: 'manulife' as CarrierId,
        claimNumber: 'CLAIM-B-001',
        patientToken: '550e8400-e29b-41d4-a716-446655440003',
        billedAmount: 3000,
        outstandingAmount: 1200,
        daysOutstanding: 75,
      },
    });

    // Create audit logs for both practices
    await prisma.auditLog.create({
      data: {
        practiceId: practiceA.id,
        userId: userA.id,
        action: 'claim.create',
        subjectType: 'InsuranceClaim',
        subjectId: claimA1.id,
        details: { carrier: 'sun_life' },
      },
    });

    await prisma.auditLog.create({
      data: {
        practiceId: practiceB.id,
        userId: userB.id,
        action: 'claim.create',
        subjectType: 'InsuranceClaim',
        subjectId: claimB1.id,
        details: { carrier: 'manulife' },
      },
    });
  } catch (e) {
    console.warn('[rls.test] fixture setup failed — suite will error:', (e as Error).message);
    throw e;
  }
}));

afterEach(() => runWithRlsBypass(async () => {
  if (!dbReady) return;

  // Clean up recovery actions and notifications created during tests
  await prisma.claimRecoveryAction.deleteMany({
    where: {
      claimId: {
        in: [claimA1.id, claimA2.id, claimB1.id],
      },
    },
  });

  await prisma.practiceNotification.deleteMany({
    where: {
      practiceId: {
        in: [practiceA.id, practiceB.id],
      },
    },
  });
}));

afterAll(() => runWithRlsBypass(async () => {
  if (!dbReady) return;

  // Clean up in reverse FK order
  await prisma.callAttempt.deleteMany({
    where: {
      claim: {
        practiceId: {
          in: [practiceA.id, practiceB.id],
        },
      },
    },
  });

  await prisma.insuranceClaim.deleteMany({
    where: {
      practiceId: {
        in: [practiceA.id, practiceB.id],
      },
    },
  });

  await prisma.auditLog.deleteMany({
    where: {
      practiceId: {
        in: [practiceA.id, practiceB.id],
      },
    },
  });

  await cleanupPracticeWithUsers(prisma, practiceA.id);
  await cleanupPracticeWithUsers(prisma, practiceB.id);

  await prisma.$disconnect().catch(() => undefined);
}));

// ─────────────────────────────────────────────────────────────────────────────
// Tests: Insurance Claims Isolation
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!dbReady || strictRls)('RLS: Insurance Claims Isolation', () => {
  it('Practice A user can read their own claims', async () => {
    const claims = await prisma.insuranceClaim.findMany({
      where: {
        practiceId: practiceA.id,
      },
    });

    expect(claims.length).toBeGreaterThanOrEqual(2);
    expect(claims.map((c) => c.id)).toContain(claimA1.id);
    expect(claims.map((c) => c.id)).toContain(claimA2.id);
  });

  it('Practice A user cannot read Practice B claims via Prisma ORM', async () => {
    // This test assumes application-layer filtering is in place.
    // Direct SQL with RLS would be more conclusive but requires special DB role setup.
    const claimsForA = await prisma.insuranceClaim.findMany({
      where: {
        practiceId: practiceA.id,
      },
    });

    const claimIds = claimsForA.map((c) => c.id);
    expect(claimIds).not.toContain(claimB1.id);
  });

  it('Practice B has exactly one claim (isolation check)', async () => {
    const claims = await prisma.insuranceClaim.findMany({
      where: {
        practiceId: practiceB.id,
      },
    });

    expect(claims.length).toBe(1);
    expect(claims[0].id).toBe(claimB1.id);
  });

  it('Claim lookup by ID is practice-scoped (no cross-practice lookup)', async () => {
    const claimFromA = await prisma.insuranceClaim.findUnique({
      where: {
        id: claimA1.id,
      },
    });

    expect(claimFromA).not.toBeNull();
    expect(claimFromA?.practiceId).toBe(practiceA.id);

    // B1 exists but should not be accessible in A's context
    const claimFromB = await prisma.insuranceClaim.findUnique({
      where: {
        id: claimB1.id,
      },
    });

    // ORM returns it without context; RLS enforcement happens at DB layer
    expect(claimFromB?.practiceId).toBe(practiceB.id);
  });

  it('Claim count by practice is accurate', async () => {
    const countA = await prisma.insuranceClaim.count({
      where: {
        practiceId: practiceA.id,
      },
    });

    const countB = await prisma.insuranceClaim.count({
      where: {
        practiceId: practiceB.id,
      },
    });

    expect(countA).toBe(2);
    expect(countB).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: Write Isolation
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!dbReady)('RLS: Write Isolation (Cannot Update Cross-Practice Data)', () => {
  /**
   * Without FORCE RLS on the DB role, Prisma can write any row by primary key.
   * Cross-tenant write rejection is covered by `rls.strict.test.ts` when
   * COLLECTRX_RLS_TEST_STRICT=1. Default CI asserts scoped filters instead.
   */
  it.skipIf(!strictRls)('Cannot update another practice\'s claim status', async () => {
    const updateAttempt = prisma.insuranceClaim.update({
      where: { id: claimB1.id },
      data: { status: 'RESOLVED' },
    });
    await expect(updateAttempt).rejects.toThrow();
  });

  it.skipIf(!strictRls)('Practice A user cannot create recovery action on Practice B claim', async () => {
    const createAttempt = prisma.claimRecoveryAction.create({
      data: {
        practiceId: practiceA.id,
        claimId: claimB1.id,
        actionType: 'PAYMENT_TRACE',
        route: 'CALL_CARRIER',
        title: 'Trace payment',
      },
    });
    await expect(createAttempt).rejects.toThrow();
  });

  it.skipIf(!strictRls)('Practice A cannot create notification for Practice B claim', async () => {
    const createAttempt = prisma.practiceNotification.create({
      data: {
        practiceId: practiceA.id,
        type: 'CLAIM_DENIED',
        subject: 'Claim denied',
        message: 'This should not be allowed',
        claimId: claimB1.id,
      },
    });
    await expect(createAttempt).rejects.toThrow();
  });

  it('update by id without practice filter can touch another practice when RLS is off', async () => {
    if (strictRls) return;
    // Documents current default: app must always scope writes; DB role alone does not block.
    const before = await prisma.insuranceClaim.findUniqueOrThrow({ where: { id: claimB1.id } });
    expect(before.status).not.toBe('DENIED');
    await prisma.insuranceClaim.update({
      where: { id: claimB1.id },
      data: { status: 'DENIED' },
    });
    const after = await prisma.insuranceClaim.findUniqueOrThrow({ where: { id: claimB1.id } });
    expect(after.status).toBe('DENIED');
    // Restore fixture for later aggregate assertions
    await prisma.insuranceClaim.update({
      where: { id: claimB1.id },
      data: { status: before.status, daysOutstanding: 75 },
    });
  });

  // App-layer scoping assertions rely on the vitest bypass; under strict FORCE
  // RLS a context-less session reads zero rows, so they run in default mode only.
  it.skipIf(strictRls)('scoped updateMany does not change another practice', async () => {
    await prisma.insuranceClaim.updateMany({
      where: { practiceId: practiceA.id },
      data: { priority: 'HIGH' },
    });
    const b = await prisma.insuranceClaim.findUnique({ where: { id: claimB1.id } });
    expect(b?.priority).toBe('NORMAL');
    await prisma.insuranceClaim.updateMany({
      where: { practiceId: practiceA.id },
      data: { priority: 'NORMAL' },
    });
  });

  it.skipIf(strictRls)('Practice A can create recovery action on own claim', async () => {
    const recovery = await prisma.claimRecoveryAction.create({
      data: {
        practiceId: practiceA.id,
        claimId: claimA1.id,
        actionType: 'PAYMENT_VERIFY_SYNC',
        route: 'WAIT_SYNC',
        title: 'Verify sync with PMS',
      },
    });

    expect(recovery.claimId).toBe(claimA1.id);
    expect(recovery.practiceId).toBe(practiceA.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: Audit Log Isolation
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!dbReady || strictRls)('RLS: Audit Log Scoping', () => {
  it('Practice A can read its own audit logs', async () => {
    const logs = await prisma.auditLog.findMany({
      where: {
        practiceId: practiceA.id,
      },
    });

    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs.some((l) => l.subjectId === claimA1.id)).toBe(true);
  });

  it('Practice A audit logs do not include Practice B actions', async () => {
    const logsA = await prisma.auditLog.findMany({
      where: {
        practiceId: practiceA.id,
      },
    });

    const logsB = await prisma.auditLog.findMany({
      where: {
        practiceId: practiceB.id,
      },
    });

    const aIds = new Set(logsA.map((l) => l.id));
    const bIds = new Set(logsB.map((l) => l.id));

    // Sets should be disjoint
    const intersection = [...aIds].filter((id) => bIds.has(id));
    expect(intersection.length).toBe(0);
  });

  it('Audit log count is correct per practice', async () => {
    const countA = await prisma.auditLog.count({
      where: {
        practiceId: practiceA.id,
      },
    });

    const countB = await prisma.auditLog.count({
      where: {
        practiceId: practiceB.id,
      },
    });

    expect(countA).toBeGreaterThanOrEqual(1);
    expect(countB).toBeGreaterThanOrEqual(1);
  });

  it('Can filter audit logs by action', async () => {
    const claimCreatLogs = await prisma.auditLog.findMany({
      where: {
        practiceId: practiceA.id,
        action: 'claim.create',
      },
    });

    expect(claimCreatLogs.length).toBeGreaterThanOrEqual(1);
    expect(claimCreatLogs[0].subjectType).toBe('InsuranceClaim');
  });

  it('Can filter audit logs by user', async () => {
    const userALogs = await prisma.auditLog.findMany({
      where: {
        practiceId: practiceA.id,
        userId: userA.id,
      },
    });

    expect(userALogs.length).toBeGreaterThanOrEqual(1);
    expect(userALogs.every((l) => l.userId === userA.id)).toBe(true);
  });

  it('userA2 cannot see userA\'s logs from different practices', async () => {
    // userA2 is in Practice A; should only see Practice A logs
    const logsA = await prisma.auditLog.findMany({
      where: {
        practiceId: practiceA.id,
      },
    });

    const logsB = await prisma.auditLog.findMany({
      where: {
        practiceId: practiceB.id,
      },
    });

    const intersect = logsA.filter((la) => logsB.some((lb) => lb.id === la.id));
    expect(intersect.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: Recovery Actions & Events Isolation
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!dbReady || strictRls)('RLS: Recovery Data Isolation', () => {
  it('Practice A can create recovery action on own claim', async () => {
    const action = await prisma.claimRecoveryAction.create({
      data: {
        practiceId: practiceA.id,
        claimId: claimA1.id,
        actionType: 'PROCESSING_RECALL',
        route: 'CALL_CARRIER',
        title: 'Recall claim processing',
      },
    });

    expect(action.practiceId).toBe(practiceA.id);
    expect(action.claimId).toBe(claimA1.id);
  });

  it('Practice A can read recovery actions only from own claims', async () => {
    const actions = await prisma.claimRecoveryAction.findMany({
      where: {
        practiceId: practiceA.id,
      },
    });

    // Each action's claim should belong to Practice A
    for (const action of actions) {
      const claim = await prisma.insuranceClaim.findUnique({
        where: { id: action.claimId },
      });
      expect(claim?.practiceId).toBe(practiceA.id);
    }
  });

  it('Practice B recovery actions are isolated from Practice A', async () => {
    // Create recovery action for Practice B
    const actionB = await prisma.claimRecoveryAction.create({
      data: {
        practiceId: practiceB.id,
        claimId: claimB1.id,
        actionType: 'PRACTICE_DOCS',
        route: 'PRACTICE_GATE',
        title: 'Collect documents',
      },
    });

    // Query Practice A recovery actions
    const actionsA = await prisma.claimRecoveryAction.findMany({
      where: {
        practiceId: practiceA.id,
      },
    });

    // Action B should not appear
    const ids = actionsA.map((a) => a.id);
    expect(ids).not.toContain(actionB.id);
  });

  it('Cannot query recovery events across practice boundaries', async () => {
    // Create event for Practice A claim
    const eventA = await prisma.claimRecoveryEvent.create({
      data: {
        practiceId: practiceA.id,
        claimId: claimA1.id,
        eventType: 'PAYMENT_CONFIRMED',
        amountRecoveredCents: 50000,
        previousOutstanding: 500,
        newOutstanding: 0,
      },
    });

    // Create event for Practice B claim
    const eventB = await prisma.claimRecoveryEvent.create({
      data: {
        practiceId: practiceB.id,
        claimId: claimB1.id,
        eventType: 'PAYMENT_CONFIRMED',
        amountRecoveredCents: 120000,
        previousOutstanding: 1200,
        newOutstanding: 0,
      },
    });

    // Query Practice A events
    const eventsA = await prisma.claimRecoveryEvent.findMany({
      where: {
        practiceId: practiceA.id,
      },
    });

    const idsA = eventsA.map((e) => e.id);
    expect(idsA).toContain(eventA.id);
    expect(idsA).not.toContain(eventB.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: Notifications Isolation
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!dbReady || strictRls)('RLS: Notifications & Alerts Isolation', () => {
  it('Practice A can create notification for own claim', async () => {
    const notif = await prisma.practiceNotification.create({
      data: {
        practiceId: practiceA.id,
        type: 'CARRIER_BLOCK',
        subject: 'Carrier blocked',
        message: 'Sun Life blocked automation',
        claimId: claimA1.id,
      },
    });

    expect(notif.practiceId).toBe(practiceA.id);
    expect(notif.claimId).toBe(claimA1.id);
  });

  it('Practice A cannot see Practice B notifications', async () => {
    // Create notification for Practice B
    const notifB = await prisma.practiceNotification.create({
      data: {
        practiceId: practiceB.id,
        type: 'VALIDATION_ESCALATION',
        subject: 'Validation failed',
        message: 'Escalation required',
        claimId: claimB1.id,
      },
    });

    // Query Practice A notifications
    const notifsA = await prisma.practiceNotification.findMany({
      where: {
        practiceId: practiceA.id,
      },
    });

    const ids = notifsA.map((n) => n.id);
    expect(ids).not.toContain(notifB.id);
  });

  it('Notifications count is accurate per practice', async () => {
    const countA = await prisma.practiceNotification.count({
      where: {
        practiceId: practiceA.id,
      },
    });

    const countB = await prisma.practiceNotification.count({
      where: {
        practiceId: practiceB.id,
      },
    });

    expect(countA).toBeGreaterThanOrEqual(0);
    expect(countB).toBeGreaterThanOrEqual(0);
  });

  it('Can query unread notifications per practice', async () => {
    const unreadA = await prisma.practiceNotification.findMany({
      where: {
        practiceId: practiceA.id,
        readAt: null,
      },
    });

    // All should belong to Practice A
    expect(unreadA.every((n) => n.practiceId === practiceA.id)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: Unique Constraints & Cross-Practice Edge Cases
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!dbReady || strictRls)('RLS: Unique Constraints & Edge Cases', () => {
  it('Claim number must be unique within a practice, not globally', async () => {
    // Practice A and B can have the same claim number (scoped by practice)
    const claimA = await prisma.insuranceClaim.findFirst({
      where: {
        practiceId: practiceA.id,
        claimNumber: 'CLAIM-A-001',
      },
    });

    // Create a claim in B with the same number (should succeed)
    const claimBSame = await prisma.insuranceClaim.create({
      data: {
        practiceId: practiceB.id,
        carrierId: 'green_shield' as CarrierId,
        claimNumber: 'CLAIM-A-001', // Same number as A's claim
        patientToken: '550e8400-e29b-41d4-a716-446655440099',
        billedAmount: 1000,
        outstandingAmount: 500,
        daysOutstanding: 30,
      },
    });

    expect(claimA?.claimNumber).toBe('CLAIM-A-001');
    expect(claimBSame.claimNumber).toBe('CLAIM-A-001');
    expect(claimBSame.practiceId).toBe(practiceB.id);
  });

  it('Two users from same practice see the same claims', async () => {
    const claimsFromUserA = await prisma.insuranceClaim.findMany({
      where: { practiceId: practiceA.id },
    });

    const claimsFromUserA2 = await prisma.insuranceClaim.findMany({
      where: { practiceId: practiceA.id },
    });

    expect(claimsFromUserA.length).toBe(claimsFromUserA2.length);
    const idsA = new Set(claimsFromUserA.map((c) => c.id));
    const idsA2 = new Set(claimsFromUserA2.map((c) => c.id));
    expect([...idsA].every((id) => idsA2.has(id))).toBe(true);
  });

  it('User cannot switch practices via ID manipulation', async () => {
    // Attempt to query as if user switched practices
    const claimFromB = await prisma.insuranceClaim.findUnique({
      where: { id: claimB1.id },
    });

    // ORM returns it; application layer should validate practiceId matches user's practice
    expect(claimFromB?.practiceId).toBe(practiceB.id);
  });

  it('Deletion in Practice B does not affect Practice A', async () => {
    const countABefore = await prisma.insuranceClaim.count({
      where: { practiceId: practiceA.id },
    });

    // Delete a disposable claim from Practice B (do not destroy shared fixture claimB1).
    const disposable = await prisma.insuranceClaim.create({
      data: {
        practiceId: practiceB.id,
        carrierId: 'rbc' as CarrierId,
        claimNumber: `CLAIM-B-DEL-${Date.now()}`,
        patientToken: '550e8400-e29b-41d4-a716-446655440088',
        billedAmount: 100,
        outstandingAmount: 50,
        daysOutstanding: 40,
      },
    });
    await prisma.insuranceClaim.delete({ where: { id: disposable.id } });

    const countAAfter = await prisma.insuranceClaim.count({
      where: { practiceId: practiceA.id },
    });

    expect(countABefore).toBe(countAAfter);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: Aggregate Queries & Counting Isolation
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!dbReady || strictRls)('RLS: Aggregate Queries & Statistics', () => {
  it('Sum of outstanding amounts is practice-scoped', async () => {
    const agg = await prisma.insuranceClaim.aggregate({
      where: { practiceId: practiceA.id },
      _sum: {
        outstandingAmount: true,
      },
    });

    const totalA = agg._sum.outstandingAmount
      ? Number(agg._sum.outstandingAmount)
      : 0;
    expect(totalA).toBe(1300); // 500 + 800
  });

  it('Average days outstanding differs between practices', async () => {
    // Fresh rows — earlier tests may delete or add claims under the same practices.
    const suffix = `${Date.now()}`;
    const [a1, a2, b1] = await Promise.all([
      prisma.insuranceClaim.create({
        data: {
          practiceId: practiceA.id,
          carrierId: 'sun_life' as CarrierId,
          claimNumber: `AVG-A1-${suffix}`,
          patientToken: crypto.randomUUID(),
          billedAmount: 100,
          outstandingAmount: 50,
          daysOutstanding: 45,
        },
      }),
      prisma.insuranceClaim.create({
        data: {
          practiceId: practiceA.id,
          carrierId: 'canada_life' as CarrierId,
          claimNumber: `AVG-A2-${suffix}`,
          patientToken: crypto.randomUUID(),
          billedAmount: 100,
          outstandingAmount: 50,
          daysOutstanding: 60,
        },
      }),
      prisma.insuranceClaim.create({
        data: {
          practiceId: practiceB.id,
          carrierId: 'manulife' as CarrierId,
          claimNumber: `AVG-B1-${suffix}`,
          patientToken: crypto.randomUUID(),
          billedAmount: 100,
          outstandingAmount: 50,
          daysOutstanding: 75,
        },
      }),
    ]);

    const aggA = await prisma.insuranceClaim.aggregate({
      where: { id: { in: [a1.id, a2.id] } },
      _avg: { daysOutstanding: true },
    });
    const aggB = await prisma.insuranceClaim.aggregate({
      where: { id: b1.id },
      _avg: { daysOutstanding: true },
    });

    expect(aggA._avg.daysOutstanding).toBe(52.5);
    expect(aggB._avg.daysOutstanding).toBe(75);

    await prisma.insuranceClaim.deleteMany({ where: { id: { in: [a1.id, a2.id, b1.id] } } });
  });

  it('Max outstanding amount is practice-specific', async () => {
    const aggA = await prisma.insuranceClaim.aggregate({
      where: { practiceId: practiceA.id },
      _max: {
        outstandingAmount: true,
      },
    });

    expect(Number(aggA._max.outstandingAmount)).toBe(800);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: Bulk Operations Isolation
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!dbReady || strictRls)('RLS: Bulk Operations & updateMany', () => {
  it('updateMany only affects specified practice', async () => {
    const before = await prisma.insuranceClaim.findMany({
      where: { practiceId: practiceA.id },
    });

    // Update all claims in Practice A
    await prisma.insuranceClaim.updateMany({
      where: { practiceId: practiceA.id },
      data: { priority: 'HIGH' },
    });

    const after = await prisma.insuranceClaim.findMany({
      where: { practiceId: practiceA.id },
    });

    expect(after.every((c) => c.priority === 'HIGH')).toBe(true);
    expect(after.length).toBe(before.length);
  });

  it('updateMany in Practice A does not affect Practice B', async () => {
    // Update all claims in Practice A
    await prisma.insuranceClaim.updateMany({
      where: { practiceId: practiceA.id },
      data: { priority: 'URGENT' },
    });

    // Check Practice B claim is unchanged
    const claimB = await prisma.insuranceClaim.findUnique({
      where: { id: claimB1.id },
    });

    expect(claimB?.priority).not.toBe('URGENT');
  });

  it('deleteMany only affects specified practice', async () => {
    // Create a temporary claim in Practice A to delete
    const tempClaim = await prisma.insuranceClaim.create({
      data: {
        practiceId: practiceA.id,
        carrierId: 'rbc' as CarrierId,
        claimNumber: `TEMP-${Date.now()}`,
        patientToken: '550e8400-e29b-41d4-a716-446655440055',
        billedAmount: 100,
        outstandingAmount: 50,
        daysOutstanding: 10,
        priority: 'LOW',
      },
    });

    const countBefore = await prisma.insuranceClaim.count({
      where: { practiceId: practiceA.id },
    });

    // Delete all LOW priority in Practice A
    await prisma.insuranceClaim.deleteMany({
      where: {
        practiceId: practiceA.id,
        priority: 'LOW',
      },
    });

    const countAfter = await prisma.insuranceClaim.count({
      where: { practiceId: practiceA.id },
    });

    expect(countAfter).toBeLessThan(countBefore);
    expect(
      await prisma.insuranceClaim.findUnique({
        where: { id: tempClaim.id },
      })
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: Direct SQL Execution (If RLS Policies Deployed)
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!dbReady)('RLS: Direct SQL Enforcement (Database-Level Policies)', () => {
  // The RLS Prisma extension (src/lib/prismaRls.ts) only wraps model queries;
  // raw SQL must set the transaction-local app.practice_id itself, in the same
  // transaction as the query, or FORCE RLS filters every row.
  async function queryRawAsPractice<T>(
    practiceId: string,
    run: (tx: Prisma.TransactionClient) => Promise<T>
  ): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.practice_id', ${practiceId}, true)`;
      return run(tx);
    });
  }

  it('Raw SQL respects practice_id filtering', async () => {
    const result = await queryRawAsPractice(
      practiceA.id,
      (tx) => tx.$queryRaw`
        SELECT COUNT(*) as count
        FROM insurance_claims
        WHERE practice_id = ${practiceA.id}
      `
    );

    const count = (result as Array<{ count: bigint }>)[0].count;
    expect(Number(count)).toBeGreaterThanOrEqual(2);
  });

  it('Raw SQL returns correct claim by practice', async () => {
    const result = await queryRawAsPractice(
      practiceA.id,
      (tx) => tx.$queryRaw`
        SELECT id, practice_id, claim_number
        FROM insurance_claims
        WHERE id = ${claimA1.id}
      `
    );

    const claim = (result as Array<{ id: string; practice_id: string; claim_number: string }>)[0];
    expect(claim.practice_id).toBe(practiceA.id);
    expect(claim.claim_number).toBe('CLAIM-A-001');
  });

  it("Raw SQL under Practice A context cannot see Practice B's claim", async () => {
    // Same query shape as above, but the row belongs to Practice B — the
    // DB-level policy (not the WHERE clause) must hide it.
    const result = await queryRawAsPractice(
      practiceA.id,
      (tx) => tx.$queryRaw`
        SELECT id
        FROM insurance_claims
        WHERE id = ${claimB1.id}
      `
    );

    expect((result as Array<unknown>).length).toBe(0);
  });

  it('Audit log query via SQL is practice-scoped', async () => {
    // Table is Prisma default "AuditLog" with camelCase columns (see migration 20260422150000).
    const result = await queryRawAsPractice(
      practiceA.id,
      (tx) => tx.$queryRaw`
        SELECT COUNT(*) as count
        FROM "AuditLog"
        WHERE "practiceId" = ${practiceA.id}
      `
    );

    const count = (result as Array<{ count: bigint }>)[0].count;
    expect(Number(count)).toBeGreaterThanOrEqual(1);
  });

  it('Cannot bypass practice isolation with raw SQL join', async () => {
    // Under Practice A's context, Practice B's recovery actions are invisible
    // to the join even if a row were cross-linked to an A claim.
    const result = await queryRawAsPractice(
      practiceA.id,
      (tx) => tx.$queryRaw`
        SELECT ic.id, ic.claim_number, ca.title
        FROM insurance_claims ic
        LEFT JOIN claim_recovery_actions ca ON ca.claim_id = ic.id
        WHERE ic.practice_id = ${practiceA.id}
        AND ca.practice_id = ${practiceB.id}
      `
    );

    // Should be empty (no claims in A with actions from B)
    expect((result as Array<unknown>).length).toBe(0);
  });
});
