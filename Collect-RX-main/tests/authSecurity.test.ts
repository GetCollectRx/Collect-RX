import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { prisma } from '../src/lib/prisma';
import { generateTokenPair, revokeToken, isTokenRevoked } from '../src/server/authToken';

describe('JWT Expiration & Session Management (Security Fix #6)', () => {
  const jwtSecret = 'test-secret-key';
  const testUserId = 'user_test_12345';
  const testPracticeId = 'practice_test_67890';

  beforeAll(async () => {
    process.env.JWT_SECRET = jwtSecret;
  });

  afterAll(async () => {
    // Cleanup test data
    await prisma.revokedToken.deleteMany({});
  });

  describe('Token Generation', () => {
    it('should generate access token with 15-minute expiration', () => {
      const tokenPair = generateTokenPair({
        userId: testUserId,
        practiceId: testPracticeId,
        role: 'practice_owner',
      });

      const decoded = jwt.decode(tokenPair.accessToken) as any;
      const issuedAt = decoded.iat || 0;
      const expiresAt = decoded.exp || 0;
      const ttl = expiresAt - issuedAt;

      // Should be approximately 15 minutes (900 seconds), with small variance for execution time
      expect(ttl).toBeGreaterThan(870); // 14.5 minutes
      expect(ttl).toBeLessThanOrEqual(900); // 15 minutes
      expect(tokenPair.expiresIn).toBe(900);
    });

    it('should generate refresh token with 7-day expiration', () => {
      const tokenPair = generateTokenPair({
        userId: testUserId,
        practiceId: testPracticeId,
        role: 'practice_owner',
      });

      const decoded = jwt.decode(tokenPair.refreshToken) as any;
      const issuedAt = decoded.iat || 0;
      const expiresAt = decoded.exp || 0;
      const ttl = expiresAt - issuedAt;

      const sevenDays = 7 * 24 * 60 * 60; // 604800 seconds
      expect(ttl).toBeGreaterThan(604700); // 7 days - 100 seconds for execution
      expect(ttl).toBeLessThanOrEqual(sevenDays);
    });

    it('should include JTI (JWT ID) in both tokens for tracking', () => {
      const tokenPair = generateTokenPair({
        userId: testUserId,
        practiceId: testPracticeId,
        role: 'practice_owner',
      });

      const accessDecoded = jwt.decode(tokenPair.accessToken) as any;
      const refreshDecoded = jwt.decode(tokenPair.refreshToken) as any;

      expect(accessDecoded.jti).toBeDefined();
      expect(refreshDecoded.jti).toBeDefined();
      // Both should share the same JTI for session tracking
      expect(accessDecoded.jti).toBe(refreshDecoded.jti);
    });

    it('should generate unique JTI for each token pair', () => {
      const pair1 = generateTokenPair({
        userId: testUserId,
        practiceId: testPracticeId,
        role: 'practice_owner',
      });

      const pair2 = generateTokenPair({
        userId: testUserId,
        practiceId: testPracticeId,
        role: 'practice_owner',
      });

      const jti1 = (jwt.decode(pair1.accessToken) as any).jti;
      const jti2 = (jwt.decode(pair2.accessToken) as any).jti;

      expect(jti1).not.toBe(jti2);
    });

    it('should mark refresh token with type field', () => {
      const tokenPair = generateTokenPair({
        userId: testUserId,
        practiceId: testPracticeId,
        role: 'practice_owner',
      });

      const refreshDecoded = jwt.decode(tokenPair.refreshToken) as any;
      expect(refreshDecoded.type).toBe('refresh');
    });
  });

  describe('Token Revocation', () => {
    it('should revoke a token by JTI', async () => {
      const tokenPair = generateTokenPair({
        userId: testUserId,
        practiceId: testPracticeId,
        role: 'office_manager',
      });

      const decoded = jwt.decode(tokenPair.accessToken) as any;
      const jti = decoded.jti;

      // Initially not revoked
      let isRevoked = await isTokenRevoked(prisma, jti);
      expect(isRevoked).toBe(false);

      // Revoke the token
      await revokeToken(prisma, jti);

      // Now should be revoked
      isRevoked = await isTokenRevoked(prisma, jti);
      expect(isRevoked).toBe(true);
    });

    it('should persist revoked tokens in database', async () => {
      const tokenPair = generateTokenPair({
        userId: testUserId,
        practiceId: testPracticeId,
        role: 'front_desk',
      });

      const decoded = jwt.decode(tokenPair.accessToken) as any;
      const jti = decoded.jti;

      await revokeToken(prisma, jti);

      // Query the database directly to verify persistence
      const revokedRecord = await prisma.revokedToken.findUnique({
        where: { jti },
      });

      expect(revokedRecord).toBeDefined();
      expect(revokedRecord?.jti).toBe(jti);
      expect(revokedRecord?.revokedAt).toBeDefined();
      expect(revokedRecord?.expiresAt).toBeDefined();
    });

    it('should set expiration on revoked tokens for cleanup', async () => {
      const tokenPair = generateTokenPair({
        userId: testUserId,
        practiceId: testPracticeId,
        role: 'billing_coordinator',
      });

      const decoded = jwt.decode(tokenPair.accessToken) as any;
      const jti = decoded.jti;

      await revokeToken(prisma, jti);

      const revokedRecord = await prisma.revokedToken.findUnique({
        where: { jti },
      });

      // The expiration should be approximately 7 days from now
      const now = new Date();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      const expiresAt = revokedRecord?.expiresAt?.getTime() || 0;
      const nowMs = now.getTime();

      expect(expiresAt).toBeGreaterThan(nowMs + sevenDaysMs - 5000); // Allow 5 seconds variance
      expect(expiresAt).toBeLessThanOrEqual(nowMs + sevenDaysMs);
    });
  });

  describe('Token Payload Security', () => {
    it('should include user ID in access token', () => {
      const userId = 'user_security_test';
      const tokenPair = generateTokenPair({
        userId,
        practiceId: testPracticeId,
        role: 'practice_owner',
      });

      const decoded = jwt.decode(tokenPair.accessToken) as any;
      expect(decoded.userId).toBe(userId);
    });

    it('should include practice ID in access token', () => {
      const practiceId = 'practice_security_test';
      const tokenPair = generateTokenPair({
        userId: testUserId,
        practiceId,
        role: 'office_manager',
      });

      const decoded = jwt.decode(tokenPair.accessToken) as any;
      expect(decoded.practiceId).toBe(practiceId);
    });

    it('should include role in access token', () => {
      const role = 'billing_coordinator';
      const tokenPair = generateTokenPair({
        userId: testUserId,
        practiceId: testPracticeId,
        role: role as any,
      });

      const decoded = jwt.decode(tokenPair.accessToken) as any;
      expect(decoded.role).toBe(role);
    });

    it('should not expose refresh token in access token', () => {
      const tokenPair = generateTokenPair({
        userId: testUserId,
        practiceId: testPracticeId,
        role: 'associate_dentist',
      });

      const accessDecoded = jwt.decode(tokenPair.accessToken) as any;
      expect(accessDecoded.type).not.toBe('refresh');
      expect(accessDecoded.type).toBeUndefined();
    });
  });

  describe('Session Isolation', () => {
    it('should track separate sessions per user', async () => {
      const user1Pair = generateTokenPair({
        userId: 'user_1',
        practiceId: testPracticeId,
        role: 'practice_owner',
      });

      const user2Pair = generateTokenPair({
        userId: 'user_2',
        practiceId: testPracticeId,
        role: 'practice_owner',
      });

      const user1Jti = (jwt.decode(user1Pair.accessToken) as any).jti;
      const user2Jti = (jwt.decode(user2Pair.accessToken) as any).jti;

      // Different users should have different JTIs
      expect(user1Jti).not.toBe(user2Jti);

      // Revoke user1's token
      await revokeToken(prisma, user1Jti);

      // User1's token should be revoked, user2's should not
      expect(await isTokenRevoked(prisma, user1Jti)).toBe(true);
      expect(await isTokenRevoked(prisma, user2Jti)).toBe(false);
    });

    it('should allow multiple concurrent sessions per user (separate JTIs)', async () => {
      const session1 = generateTokenPair({
        userId: 'user_concurrent',
        practiceId: testPracticeId,
        role: 'office_manager',
      });

      const session2 = generateTokenPair({
        userId: 'user_concurrent',
        practiceId: testPracticeId,
        role: 'office_manager',
      });

      const jti1 = (jwt.decode(session1.accessToken) as any).jti;
      const jti2 = (jwt.decode(session2.accessToken) as any).jti;

      expect(jti1).not.toBe(jti2);

      // Both sessions are initially valid
      expect(await isTokenRevoked(prisma, jti1)).toBe(false);
      expect(await isTokenRevoked(prisma, jti2)).toBe(false);

      // Revoke first session
      await revokeToken(prisma, jti1);

      // Only first should be revoked
      expect(await isTokenRevoked(prisma, jti1)).toBe(true);
      expect(await isTokenRevoked(prisma, jti2)).toBe(false);
    });
  });

  describe('Security Properties', () => {
    it('should use HS256 algorithm (not vulnerable to alg:none)', () => {
      const tokenPair = generateTokenPair({
        userId: testUserId,
        practiceId: testPracticeId,
        role: 'practice_owner',
      });

      const header = jwt.decode(tokenPair.accessToken, { complete: true })?.header;
      expect(header?.alg).toBe('HS256');
    });

    it('should include issuer in token', () => {
      const tokenPair = generateTokenPair({
        userId: testUserId,
        practiceId: testPracticeId,
        role: 'practice_owner',
      });

      const decoded = jwt.decode(tokenPair.accessToken) as any;
      expect(decoded.iss).toBe('collectrx');
    });

    it('should include audience in access token', () => {
      const tokenPair = generateTokenPair({
        userId: testUserId,
        practiceId: testPracticeId,
        role: 'practice_owner',
      });

      const decoded = jwt.decode(tokenPair.accessToken) as any;
      expect(decoded.aud).toBe('collectrx-app');
    });

    it('should use standard JWT claims (sub for user ID)', () => {
      const tokenPair = generateTokenPair({
        userId: testUserId,
        practiceId: testPracticeId,
        role: 'practice_owner',
      });

      const decoded = jwt.decode(tokenPair.accessToken) as any;
      expect(decoded.sub).toBe(testUserId);
    });
  });
});
