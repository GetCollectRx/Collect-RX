import { describe, expect, it, vi } from 'vitest';
import { checkDispatchApprovalGate } from '../../src/carriers/adapter.js';

function mockPrisma(queueEntry: { approvalStatus: string } | null) {
  return {
    callQueue: {
      findUnique: vi.fn().mockResolvedValue(queueEntry),
    },
  } as unknown as import('@prisma/client').PrismaClient;
}

describe('checkDispatchApprovalGate', () => {
  it('blocks a claim still PENDING_REVIEW', async () => {
    const prisma = mockPrisma({ approvalStatus: 'PENDING_REVIEW' });
    const gate = await checkDispatchApprovalGate(prisma, 'claim-1');
    expect(gate.allowed).toBe(false);
    expect(gate.code).toBe('PENDING_DISPATCH_APPROVAL');
    expect(gate.reason).toMatch(/not been approved/i);
  });

  it('blocks a claim that was SKIPPED, with a distinct reason', async () => {
    const prisma = mockPrisma({ approvalStatus: 'SKIPPED' });
    const gate = await checkDispatchApprovalGate(prisma, 'claim-1');
    expect(gate.allowed).toBe(false);
    expect(gate.code).toBe('PENDING_DISPATCH_APPROVAL');
    expect(gate.reason).toMatch(/skipped/i);
  });

  it('allows a claim that is APPROVED', async () => {
    const prisma = mockPrisma({ approvalStatus: 'APPROVED' });
    const gate = await checkDispatchApprovalGate(prisma, 'claim-1');
    expect(gate.allowed).toBe(true);
  });

  it('fails closed (blocks) when no CallQueue row is found', async () => {
    const prisma = mockPrisma(null);
    const gate = await checkDispatchApprovalGate(prisma, 'claim-1');
    expect(gate.allowed).toBe(false);
  });
});
