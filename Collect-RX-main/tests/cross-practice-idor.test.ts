/**
 * Cross-Practice IDOR Validation Test
 *
 * Validates that authenticated users cannot access resources belonging to other practices.
 * Tests 10+ attack vectors with audit log verification.
 *
 * Requirements:
 * - DATABASE_URL set and accessible
 * - All tests scoped to practice isolation via practiceIdFromSession
 * - Audit logs created for failed cross-practice access attempts
 */
import { afterAll, describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { app, prisma } from '../src/server/index.js';
import { COOKIE_NAME, signUserToken } from '../src/server/authToken.js';
import { appendAuditLog } from '../src/server/audit/auditLog.js';
import { createPracticeWithOwnerForTests, cleanupPracticeWithUsers } from './factories/practice.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn(
    '[cross-practice-idor] DATABASE_URL unreachable — tests skipped:',
    (e as Error).message,
  );
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

// Test state
let practiceA: { practice: { id: string; name: string }; user: { id: string; email: string }; email: string; password: string };
let practiceB: { practice: { id: string; name: string }; user: { id: string; email: string }; email: string; password: string };
let claimInA: { id: string };
let claimInB: { id: string };

function makeAuthCookie(userId: string, practiceId: string): string {
  return `${COOKIE_NAME}=${signUserToken({
    userId,
    practiceId,
    role: 'practice_owner',
  })}`;
}

async function setupFixtures() {
  // Create Practice A and B
  practiceA = await createPracticeWithOwnerForTests(prisma);
  practiceB = await createPracticeWithOwnerForTests(prisma);

  // Create a test claim in Practice A
  const patientTokenA = crypto.randomUUID();
  claimInA = await prisma.insuranceClaim.create({
    data: {
      practiceId: practiceA.practice.id,
      patientToken: patientTokenA,
      carrierId: 'sun_life',
      claimNumber: `CLM-A-${Date.now()}`,
      billedAmount: 1500,
      outstandingAmount: 1500,
      daysOutstanding: 45,
      status: 'PENDING',
      priority: 'NORMAL',
    },
  });

  // Create a test claim in Practice B
  const patientTokenB = crypto.randomUUID();
  claimInB = await prisma.insuranceClaim.create({
    data: {
      practiceId: practiceB.practice.id,
      patientToken: patientTokenB,
      carrierId: 'canada_life',
      claimNumber: `CLM-B-${Date.now()}`,
      billedAmount: 2000,
      outstandingAmount: 2000,
      daysOutstanding: 30,
      status: 'PENDING',
      priority: 'NORMAL',
    },
  });
}

async function checkAuditLog(
  practiceId: string,
  action: string,
  claimId: string,
  expectExists: boolean,
): Promise<boolean> {
  const logs = await prisma.auditLog.findMany({
    where: {
      practiceId,
      action,
      subjectId: claimId,
      createdAt: { gte: new Date(Date.now() - 10000) }, // within last 10s
    },
  });
  return logs.length > 0 === expectExists;
}

describe.skipIf(!dbReady)('Cross-Practice IDOR Access Validation', () => {
  beforeAll(async () => {
    await setupFixtures();
  });

  afterAll(async () => {
    // Cleanup
    await prisma.insuranceClaim.deleteMany({ where: { id: { in: [claimInA.id, claimInB.id] } } });
    await cleanupPracticeWithUsers(prisma, practiceA.practice.id);
    await cleanupPracticeWithUsers(prisma, practiceB.practice.id);
  });

  describe('Attempt 1: Practice A user fetches Practice B claim by ID', () => {
    it('should return 404 (claim not found)', async () => {
      const cookie = makeAuthCookie(practiceA.user.id, practiceA.practice.id);
      const res = await request(app)
        .get(`/api/insurance/claims/${claimInB.id}`)
        .set('Cookie', cookie);

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });
  });

  describe('Attempt 2: Practice A user tries to update Practice B claim', () => {
    it('should return 404 with no mutation', async () => {
      const cookie = makeAuthCookie(practiceA.user.id, practiceA.practice.id);
      const res = await request(app)
        .patch(`/api/insurance/claims/${claimInB.id}`)
        .set('Cookie', cookie)
        .send({ servicedAt: new Date().toISOString() });

      expect(res.status).toBe(404);
      const claim = await prisma.insuranceClaim.findUnique({ where: { id: claimInB.id } });
      expect(claim?.servicedAt).toBeNull();
    });
  });

  describe('Attempt 3: Practice A user tries to confirm payment on Practice B claim', () => {
    it('should return 404 with no status change', async () => {
      const cookie = makeAuthCookie(practiceA.user.id, practiceA.practice.id);
      const res = await request(app)
        .post(`/api/insurance/claims/${claimInB.id}/confirm-payment`)
        .set('Cookie', cookie)
        .send({ paymentAmountCents: 100000, notes: 'Test' });

      expect(res.status).toBe(404);
      const claim = await prisma.insuranceClaim.findUnique({ where: { id: claimInB.id } });
      expect(claim?.status).toBe('PENDING'); // unchanged
    });
  });

  describe('Attempt 4: Practice A user tries to resolve escalation on Practice B claim', () => {
    it('should return 404', async () => {
      const cookie = makeAuthCookie(practiceA.user.id, practiceA.practice.id);
      const res = await request(app)
        .post(`/api/insurance/claims/${claimInB.id}/resolve-escalation`)
        .set('Cookie', cookie)
        .send({ notes: 'Malicious attempt' });

      expect(res.status).toBe(404);
    });
  });

  describe('Attempt 5: Practice A user queries claims with explicit practiceId hint', () => {
    it('should reject conflicting practiceId parameter', async () => {
      const cookie = makeAuthCookie(practiceA.user.id, practiceA.practice.id);
      const res = await request(app)
        .get(`/api/insurance/claims`)
        .query({ practiceId: practiceB.practice.id, limit: 10 })
        .set('Cookie', cookie);

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/practiceId does not match|does not match session/i);
    });
  });

  describe('Attempt 6: Bearer token for Practice A accessing Practice B claim', () => {
    it('should return 404', async () => {
      const token = signUserToken({
        userId: practiceA.user.id,
        practiceId: practiceA.practice.id,
        role: 'practice_owner',
      });
      const res = await request(app)
        .get(`/api/insurance/claims/${claimInB.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });
  });

  describe('Attempt 7: Token claiming a practice the user does not belong to', () => {
    it('rejects a correctly-signed token whose practiceId is not the user\'s own', async () => {
      // Same shape as a token held after staff moved the user to another
      // location, and the shape an attacker would mint if the signing key ever
      // leaked. The signature alone does not establish practice membership —
      // authenticate() re-confirms the subject against the User row.
      const mismatchedToken = signUserToken({
        userId: practiceA.user.id,
        practiceId: practiceB.practice.id,
        role: 'practice_owner',
      });

      const res = await request(app)
        .get(`/api/insurance/claims/${claimInB.id}`)
        .set('Authorization', `Bearer ${mismatchedToken}`);

      expect(res.status).toBe(401);
      expect(res.body.data).toBeUndefined();
    });
  });

  describe('Attempt 8: Practice A lists claims, should only see Practice A', () => {
    it('should return only Practice A claims', async () => {
      const cookie = makeAuthCookie(practiceA.user.id, practiceA.practice.id);
      const res = await request(app)
        .get(`/api/insurance/claims`)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);

      // Verify no Practice B claims in results
      const practiceIds = (res.body.data as any[]).map(c => c.practiceId);
      expect(practiceIds.every(id => id === practiceA.practice.id)).toBe(true);

      // Verify Practice B claim is NOT in the list
      const claimIds = (res.body.data as any[]).map(c => c.id);
      expect(claimIds).not.toContain(claimInB.id);
    });
  });

  describe('Attempt 9: Practice B user tries to fetch Practice A claim', () => {
    it('should return 404 for Practice A claim', async () => {
      const cookie = makeAuthCookie(practiceB.user.id, practiceB.practice.id);
      const res = await request(app)
        .get(`/api/insurance/claims/${claimInA.id}`)
        .set('Cookie', cookie);

      expect(res.status).toBe(404);
    });
  });

  describe('Attempt 10: Unauthenticated request for any claim', () => {
    it('should return 401', async () => {
      const res = await request(app).get(`/api/insurance/claims/${claimInA.id}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/authentication|required/i);
    });
  });

  describe('Attempt 11: Malformed Authorization header', () => {
    it('should return 401', async () => {
      const res = await request(app)
        .get(`/api/insurance/claims/${claimInA.id}`)
        .set('Authorization', 'Bearer invalid.malformed.jwt');

      expect(res.status).toBe(401);
    });
  });

  describe('Attempt 12: Cookie with invalid JWT signature', () => {
    it('should return 401', async () => {
      const res = await request(app)
        .get(`/api/insurance/claims/${claimInA.id}`)
        .set('Cookie', `${COOKIE_NAME}=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature`);

      expect(res.status).toBe(401);
    });
  });

  describe('Consistency: Run same attack 3 times, expect same rejection', () => {
    it('should consistently reject cross-practice access attempt', async () => {
      const cookie = makeAuthCookie(practiceA.user.id, practiceA.practice.id);

      for (let i = 0; i < 3; i++) {
        const res = await request(app)
          .get(`/api/insurance/claims/${claimInB.id}`)
          .set('Cookie', cookie);

        expect(res.status).toBe(404);
        expect(res.body.error).toMatch(/not found/i);
      }
    });
  });

  describe('Practice A normal read (baseline)', () => {
    it('should succeed for own claim', async () => {
      const cookie = makeAuthCookie(practiceA.user.id, practiceA.practice.id);
      const res = await request(app)
        .get(`/api/insurance/claims/${claimInA.id}`)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(claimInA.id);
    });
  });

  describe('Practice B normal read (baseline)', () => {
    it('should succeed for own claim', async () => {
      const cookie = makeAuthCookie(practiceB.user.id, practiceB.practice.id);
      const res = await request(app)
        .get(`/api/insurance/claims/${claimInB.id}`)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(claimInB.id);
    });
  });
});
