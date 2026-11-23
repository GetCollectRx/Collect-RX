import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { checkCarrierBlock } from '../src/carriers/adapter';

type CarrierArg = Parameters<typeof checkCarrierBlock>[2];
const CARRIER = 'SUN_LIFE' as CarrierArg;
const BLOCKED_AT = new Date('2026-11-01T14:00:00Z');

/** practice-a has an open CARRIER_BLOCK; practice-c shares an organization with it. */
function fakePrisma(): PrismaClient {
  const hasBlock = (practiceId: unknown): boolean => {
    if (typeof practiceId === 'string') return practiceId === 'practice-a';
    if (practiceId && typeof practiceId === 'object' && 'in' in practiceId) {
      return (practiceId as { in: string[] }).in.includes('practice-a');
    }
    return false;
  };
  return {
    carrierBlockEvent: {
      findFirst: vi.fn(async ({ where }: { where: { practiceId: unknown } }) =>
        hasBlock(where.practiceId) ? { blockedAt: BLOCKED_AT } : null),
    },
    organizationPractice: {
      findMany: vi.fn(async ({ where }: { where: { practiceId?: string; organizationId?: unknown } }) => {
        if (where.practiceId === 'practice-c') return [{ organizationId: 'org-1' }];
        if (where.organizationId) return [{ practiceId: 'practice-a' }];
        return [];
      }),
    },
  } as unknown as PrismaClient;
}

describe('CARRIER_BLOCK scope', () => {
  it('blocks the practice that tripped the block', async () => {
    const guard = await checkCarrierBlock(fakePrisma(), 'practice-a', CARRIER);
    expect(guard).toMatchObject({ allowed: false, code: 'CARRIER_BLOCK' });
  });

  it('does not block an unrelated practice on the same carrier', async () => {
    const guard = await checkCarrierBlock(fakePrisma(), 'practice-b', CARRIER);
    expect(guard).toEqual({ allowed: true });
  });

  it('blocks sibling locations in the same organization', async () => {
    const guard = await checkCarrierBlock(fakePrisma(), 'practice-c', CARRIER);
    expect(guard.allowed).toBe(false);
    expect(guard.allowed ? '' : guard.reason).toContain('organization');
  });
});
