import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  appendAuditLog,
  appendRequiredAuditLog,
  computeAuditIntegrityHash,
  verifyTenantAuditIntegrity,
} from '../src/server/audit/auditLog.js';
import { createAuditPhiAccessMiddleware } from '../src/server/middleware/auditPhiAccess.js';

function chainedRow(input: {
  id: string;
  practiceId: string;
  createdAt: Date;
  previousHash: string | null;
  action?: string;
}) {
  const row = {
    id: input.id,
    createdAt: input.createdAt,
    practiceId: input.practiceId,
    userId: 'user-1',
    action: input.action ?? 'read',
    subjectType: 'claim',
    subjectId: 'claim-1',
    details: null,
    requestIp: null,
    userAgent: null,
    previousHash: input.previousHash,
    integrityHash: '',
  };
  row.integrityHash = computeAuditIntegrityHash(row);
  return row;
}

describe('tenant-safe audit chaining', () => {
  it('serializes by tenant in the DB transaction and links only that tenant chain', async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const findFirst = vi.fn().mockResolvedValue({ integrityHash: 'tenant-a-prior' });
    const create = vi.fn().mockResolvedValue({});
    const tx = { $executeRaw: executeRaw, auditLog: { findFirst, create } };
    const prisma = {
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<void>) => fn(tx)),
    } as unknown as PrismaClient;

    await appendRequiredAuditLog(prisma, { practiceId: 'tenant-a', action: 'claim.read' });

    expect(executeRaw).toHaveBeenCalledOnce();
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { practiceId: 'tenant-a', integrityHash: { not: null } },
    }));
    expect(create.mock.calls[0]![0].data.previousHash).toBe('tenant-a-prior');
    expect(create.mock.calls[0]![0].data.integrityHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifies one retained tenant segment and detects mutation or a broken link', async () => {
    const first = chainedRow({
      id: 'a1', practiceId: 'tenant-a', createdAt: new Date('2026-09-20T12:00:00Z'),
      previousHash: 'authorized-retention-anchor',
    });
    const second = chainedRow({
      id: 'a2', practiceId: 'tenant-a', createdAt: new Date('2026-09-20T12:01:00Z'),
      previousHash: first.integrityHash,
    });
    const findMany = vi.fn().mockResolvedValue([first, second]);
    const prisma = { auditLog: { findMany } } as unknown as PrismaClient;

    await expect(verifyTenantAuditIntegrity(prisma, 'tenant-a')).resolves.toEqual({
      valid: true, checked: 2,
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { practiceId: 'tenant-a', integrityHash: { not: null } },
    }));

    findMany.mockResolvedValueOnce([first, { ...second, action: 'tampered' }]);
    await expect(verifyTenantAuditIntegrity(prisma, 'tenant-a')).resolves.toEqual({
      valid: false, checked: 2, firstBrokenId: 'a2',
    });
  });
});

describe('fail-closed consequential audit', () => {
  it('throws for required audit failure but preserves best-effort behavior when not required', async () => {
    const prisma = {
      $transaction: vi.fn().mockRejectedValue(new Error('audit database unavailable')),
    } as unknown as PrismaClient;

    await expect(appendRequiredAuditLog(prisma, {
      practiceId: 'tenant-a', action: 'consequential.write',
    })).rejects.toThrow('audit database unavailable');
    await expect(appendAuditLog(prisma, {
      practiceId: 'tenant-a', action: 'diagnostic.read',
    })).resolves.toBeUndefined();
  });

  it('uses authenticated tenant identity, ignores a conflicting hint, and blocks before next on audit failure', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      auditLog: { findFirst, create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<void>) => fn(tx)),
      phiAccessEvent: { create: vi.fn().mockRejectedValue(new Error('down')) },
    } as unknown as PrismaClient;
    const middleware = createAuditPhiAccessMiddleware(prisma);
    const req = {
      auth: {
        role: 'practice_owner', userId: 'user-a', practiceId: 'tenant-a',
        phiAccess: true, userRole: 'practice_owner',
      },
      practiceAuth: undefined,
      query: { practiceId: 'tenant-b' },
      body: {}, params: {}, headers: {}, method: 'GET',
      baseUrl: '/api/insurance', path: '/claims', ip: '127.0.0.1', socket: {},
    } as never;
    const json = vi.fn();
    const res = { status: vi.fn().mockReturnValue({ json }) } as never;
    const next = vi.fn();

    await middleware(req, res, next);

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { practiceId: 'tenant-a', integrityHash: { not: null } },
    }));
    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({
      error: 'Required audit trail is unavailable; access was not performed',
    });
  });
});
