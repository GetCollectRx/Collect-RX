import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prospect, PrismaClient } from '@prisma/client';
import { makeProspect } from '../factories/prospect.js';

vi.mock('../../src/server/marketing/prospectEmail.js', () => ({
  sendProspectEmail: vi.fn(),
}));

const baseProspect: Prospect = makeProspect({
  contactName: 'Dr. Jane Smith',
  stage: 'new',
  sequenceStep: 0,
  campaignId: 'camp1',
});

function mockPrisma(prospects: Prospect[] = [baseProspect]) {
  return {
    prospect: {
      findMany: vi.fn().mockResolvedValue(prospects),
      update: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient;
}

describe('runEmailCampaignScheduler — CASL sender identity requirement', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.MAILING_ADDRESS;
    delete process.env.SENDER_PHONE;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('refuses to run and sends nothing when MAILING_ADDRESS and SENDER_PHONE are both unset', async () => {
    const { sendProspectEmail } = await import('../../src/server/marketing/prospectEmail.js');
    const { runEmailCampaignScheduler } = await import('../../src/server/marketing/emailCampaignScheduler.js');

    const prisma = mockPrisma();
    const result = await runEmailCampaignScheduler(prisma);

    expect(result.sent).toBe(0);
    expect(result.configError).toMatch(/MAILING_ADDRESS/);
    expect(result.configError).toMatch(/SENDER_PHONE/);
    expect(sendProspectEmail).not.toHaveBeenCalled();
    expect(prisma.prospect.findMany).not.toHaveBeenCalled();
  });

  it('refuses to run when only MAILING_ADDRESS is set', async () => {
    process.env.MAILING_ADDRESS = '123 Main St, Toronto, ON';
    const { sendProspectEmail } = await import('../../src/server/marketing/prospectEmail.js');
    const { runEmailCampaignScheduler } = await import('../../src/server/marketing/emailCampaignScheduler.js');

    const prisma = mockPrisma();
    const result = await runEmailCampaignScheduler(prisma);

    expect(result.configError).toMatch(/SENDER_PHONE/);
    expect(sendProspectEmail).not.toHaveBeenCalled();
  });

  it('refuses to run when only SENDER_PHONE is set', async () => {
    process.env.SENDER_PHONE = '416-555-0100';
    const { sendProspectEmail } = await import('../../src/server/marketing/prospectEmail.js');
    const { runEmailCampaignScheduler } = await import('../../src/server/marketing/emailCampaignScheduler.js');

    const prisma = mockPrisma();
    const result = await runEmailCampaignScheduler(prisma);

    expect(result.configError).toMatch(/MAILING_ADDRESS/);
    expect(sendProspectEmail).not.toHaveBeenCalled();
  });

  it('sends once both MAILING_ADDRESS and SENDER_PHONE are configured', async () => {
    process.env.MAILING_ADDRESS = '123 Main St, Toronto, ON';
    process.env.SENDER_PHONE = '416-555-0100';
    const { sendProspectEmail } = await import('../../src/server/marketing/prospectEmail.js');
    vi.mocked(sendProspectEmail).mockResolvedValue(true);
    const { runEmailCampaignScheduler } = await import('../../src/server/marketing/emailCampaignScheduler.js');

    const prisma = mockPrisma();
    const result = await runEmailCampaignScheduler(prisma);

    expect(result.configError).toBeUndefined();
    expect(result.sent).toBe(1);
    expect(sendProspectEmail).toHaveBeenCalledWith(
      baseProspect,
      expect.objectContaining({ activityType: 'email_initial_sent' }),
      prisma,
    );
    expect(prisma.prospect.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: baseProspect.id },
        data: expect.objectContaining({ stage: 'contacted' }),
      }),
    );
  });
});
