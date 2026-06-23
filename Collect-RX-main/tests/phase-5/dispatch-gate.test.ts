import { describe, expect, it, vi } from 'vitest';
import { checkRecoveryDispatchGate } from '../../src/server/recovery/dispatchGate.js';

function mockPrisma(claim: Record<string, unknown> | null, blocking: { title: string; actionType: string } | null) {
  return {
    insuranceClaim: {
      findUnique: vi.fn().mockResolvedValue(claim),
    },
    claimRecoveryAction: {
      findFirst: vi.fn().mockResolvedValue(blocking),
    },
  } as unknown as import('@prisma/client').PrismaClient;
}

describe('checkRecoveryDispatchGate', () => {
  it('blocks all BLOCKING action types including HUMAN_ESCALATION', async () => {
    const prisma = mockPrisma(
      {
        recoveryRoute: 'PRACTICE_GATE',
        status: 'ESCALATED',
        queueEntry: { scheduledFor: new Date(0), status: 'ESCALATED' },
      },
      { title: 'Human verification required', actionType: 'HUMAN_ESCALATION' },
    );

    const gate = await checkRecoveryDispatchGate(prisma, 'claim-1');
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/PRACTICE_GATE|human escalation/i);
  });

  it('blocks CDCP_RECONSIDERATION gate', async () => {
    const prisma = mockPrisma(
      {
        recoveryRoute: 'OPEN_CDCP',
        status: 'ESCALATED',
        queueEntry: null,
      },
      null,
    );

    const gate = await checkRecoveryDispatchGate(prisma, 'claim-1');
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/OPEN_CDCP/);
  });

  it('allows call when no blocking gates and recall due', async () => {
    const prisma = mockPrisma(
      {
        recoveryRoute: 'CALL_CARRIER',
        status: 'IN_QUEUE',
        queueEntry: { scheduledFor: new Date(0), status: 'PENDING' },
      },
      null,
    );

    const gate = await checkRecoveryDispatchGate(prisma, 'claim-1');
    expect(gate.allowed).toBe(true);
  });
});
