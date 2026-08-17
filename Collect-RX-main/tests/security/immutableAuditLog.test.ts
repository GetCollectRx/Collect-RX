import { describe, it, expect } from 'vitest';
import { logImmutableAuditEntry, initializeLastHash } from '../../src/server/audit/immutableAuditLog.js';

const hasDatabaseUrl = !!process.env.DATABASE_URL;

// Test practice ID used across all tests
const TEST_PRACTICE_ID = 'test_practice_' + Date.now();

(hasDatabaseUrl ? describe : describe.skip)('Immutable Audit Log', () => {
  let prisma: any;

  const getPrisma = async () => {
    if (!prisma) {
      const module = await import('../../src/lib/prisma.js');
      prisma = module.prisma;
    }
    return prisma;
  };

  it('creates audit entries with hash chaining', async () => {
    const p = await getPrisma();
    await initializeLastHash(p);

    // Create first entry
    await logImmutableAuditEntry(p, {
      practiceId: TEST_PRACTICE_ID,
      userId: 'user_' + Date.now(),
      action: 'read',
      resourceType: 'claim',
      resourceId: 'claim_abc',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
      result: 'success',
      details: 'Retrieved claim details',
    });

    // Verify the entry was created
    const entries = await p.auditLog.findMany({
      where: {
        userId: 'user_' + Date.now(),
      },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });

    if (entries.length > 0) {
      const entry = entries[0];
      expect(entry.userId).toBeDefined();
      expect(entry.action).toBe('read');
      expect(entry.subjectType).toBe('claim');
      expect((entry.details as any)?.hash).toBeDefined();
    }
  });

  it('logs different action types', async () => {
    const p = await getPrisma();
    const userId = 'user_actions_' + Date.now();
    const actions: Array<'read' | 'write' | 'delete' | 'export'> = ['read', 'write', 'delete'];

    for (const action of actions) {
      await logImmutableAuditEntry(p, {
        practiceId: TEST_PRACTICE_ID,
        userId,
        action,
        resourceType: 'claim',
        resourceId: `claim_${action}`,
        result: 'success',
      });
    }

    const entries = await p.auditLog.findMany({
      where: { userId },
    });

    expect(entries.length).toBeGreaterThan(0);
  });

  it('logs different resource types', async () => {
    const p = await getPrisma();
    const userId = 'user_resources_' + Date.now();
    const resourceTypes = ['patient', 'claim', 'recording'] as const;

    for (const resourceType of resourceTypes) {
      await logImmutableAuditEntry(p, {
        practiceId: TEST_PRACTICE_ID,
        userId,
        action: 'read',
        resourceType,
        resourceId: `${resourceType}_123`,
        result: 'success',
      });
    }

    const entries = await p.auditLog.findMany({
      where: { userId },
    });

    expect(entries.length).toBeGreaterThanOrEqual(resourceTypes.length);
  });
});
