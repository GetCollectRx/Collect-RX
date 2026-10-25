import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

vi.mock('../../src/server/marketing/referralEngine.js', () => ({
  runReferralSequenceTick: vi.fn().mockResolvedValue(0),
}));
vi.mock('../../src/server/marketing/demoScheduler.js', () => ({
  runPreDemoEmailTick: vi.fn().mockResolvedValue(0),
}));
vi.mock('../../src/server/marketing/postDemoFollowUp.js', () => ({
  runPostDemoReminderTick: vi.fn().mockResolvedValue(0),
}));

function mockPrisma() {
  return {
    prospect: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaClient;
}

describe('runMarketingSequenceTick', () => {
  it('excludes prospects held for outreach batch review from every tick', async () => {
    const prisma = mockPrisma();
    const { runMarketingSequenceTick } = await import('../../src/server/marketing/sequenceEngine.js');

    await runMarketingSequenceTick(prisma);

    expect(prisma.prospect.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ pendingOutreachApproval: false }),
      }),
    );
  });
});
