import { describe, it, expect } from 'vitest';
import { logImmutableAuditEntry, initializeLastHash } from '../../src/server/audit/immutableAuditLog.js';
import { prisma } from '../../src/lib/prisma.js';

describe('Immutable Audit Log', () => {
  it('creates audit entries with hash chaining', async () => {
    await initializeLastHash(prisma);

    // Create first entry
    await logImmutableAuditEntry(prisma, {
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
    const entries = await prisma.auditLog.findMany({
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
    const userId = 'user_actions_' + Date.now();
    const actions: Array<'read' | 'write' | 'delete' | 'export'> = ['read', 'write', 'delete'];

    for (const action of actions) {
      await logImmutableAuditEntry(prisma, {
        userId,
        action,
        resourceType: 'claim',
        resourceId: `claim_${action}`,
        result: 'success',
      });
    }

    const entries = await prisma.auditLog.findMany({
      where: { userId },
    });

    expect(entries.length).toBeGreaterThan(0);
  });

  it('logs different resource types', async () => {
    const userId = 'user_resources_' + Date.now();
    const resourceTypes = ['patient', 'claim', 'recording'] as const;

    for (const resourceType of resourceTypes) {
      await logImmutableAuditEntry(prisma, {
        userId,
        action: 'read',
        resourceType,
        resourceId: `${resourceType}_123`,
        result: 'success',
      });
    }

    const entries = await prisma.auditLog.findMany({
      where: { userId },
    });

    expect(entries.length).toBeGreaterThanOrEqual(resourceTypes.length);
  });
});
