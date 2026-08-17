/**
 * Org-level equivalent of the practice confirm-overage flow — before this,
 * a pooled org that paused on OVERAGE_PENDING had no route/UI to resume
 * calling at all (see evaluateOrgCallGate in usagePeriodService.ts).
 */
import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { confirmOrgOverage } from '../src/server/plans/usagePeriodService.js';

const ORG_ID = 'org-1';

function orgPrisma(overrides: Record<string, unknown> = {}) {
  const updateSpy = vi.fn(async (args: unknown) => args);
  const prisma = {
    organization: {
      findUnique: vi.fn(async () => ({
        id: ORG_ID,
        callsPaused: true,
        callsPausedReason: 'overage_pending',
        callsPausedAt: new Date(),
        overageConfirmed: false,
        overageConfirmedAt: null,
        ...overrides,
      })),
      update: updateSpy,
    },
  } as unknown as PrismaClient;
  return { prisma, updateSpy };
}

describe('confirmOrgOverage', () => {
  it('resumes a pooled org paused on overage_pending', async () => {
    const { prisma, updateSpy } = orgPrisma();
    const result = await confirmOrgOverage(prisma, ORG_ID);
    expect(result.status).toBe('resumed');
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ORG_ID },
        data: expect.objectContaining({
          callsPaused: false,
          callsPausedReason: null,
          overageConfirmed: true,
        }),
      }),
    );
  });

  it('is a no-op when the org is not paused for overage', async () => {
    const { prisma, updateSpy } = orgPrisma({ callsPaused: false, callsPausedReason: null });
    const result = await confirmOrgOverage(prisma, ORG_ID);
    expect(result.status).toBe('not_paused');
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('is a no-op when paused for a different reason (e.g. cogs_breaker)', async () => {
    const { prisma, updateSpy } = orgPrisma({ callsPausedReason: 'cogs_breaker' });
    const result = await confirmOrgOverage(prisma, ORG_ID);
    expect(result.status).toBe('not_paused');
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('expires the confirmation window after 24 hours', async () => {
    const { prisma, updateSpy } = orgPrisma({ callsPausedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) });
    const result = await confirmOrgOverage(prisma, ORG_ID);
    expect(result.status).toBe('expired');
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
