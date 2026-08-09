import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient, Prospect } from '@prisma/client';

vi.mock('../../src/server/marketing/geminiClient.js', () => ({
  runGeminiJson: vi.fn(),
}));

const baseProspect: Prospect = {
  id: 'p1',
  practiceName: 'Downtown Dental',
  contactName: null,
  email: 'office@downtown.ca',
  phone: '4165550100',
  city: 'Toronto',
  province: 'ON',
  website: null,
  googlePlaceId: null,
  score: 80,
  stage: 'contacted',
  source: 'harvest',
  pmsHint: null,
  sequenceStep: 1,
  sequencePausedUntil: null,
  sequenceCompleted: false,
  referralStep: 0,
  referralCompleted: false,
  emailOpenCount: 2,
  emailClickCount: 0,
  lastEmailSentAt: null,
  lastEngagedAt: null,
  closedWonAt: null,
  demoScheduledAt: null,
  preDemoEmailSentAt: null,
  dnclCheckedAt: null,
  dnclListed: null,
  hubspotDealId: null,
  campaignId: null,
  linkedPracticeId: null,
  optOutAt: null,
  trialStartedAt: null,
  trialSequenceStep: 0,
  callSummary: null,
  replyIntent: null,
  suggestedReply: null,
  painPoints: null,
  metadata: null,
  lastVapiCallId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function mockPrisma(overrides: Partial<Prospect> = {}) {
  const prospect = { ...baseProspect, ...overrides };
  return {
    prospect: {
      findUnique: vi.fn().mockResolvedValue(prospect),
      findUniqueOrThrow: vi.fn().mockResolvedValue(prospect),
      update: vi.fn().mockImplementation(({ data }: { data: Partial<Prospect> }) =>
        Promise.resolve({ ...prospect, ...data }),
      ),
    },
    prospectActivity: {
      create: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient;
}

describe('processInboundReply — unsubscribe intent detection', () => {
  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('regex fallback: opts out on an explicit unsubscribe request', async () => {
    const { runGeminiJson } = await import('../../src/server/marketing/geminiClient.js');
    vi.mocked(runGeminiJson).mockResolvedValue(null);

    const prisma = mockPrisma();
    const { processInboundReply } = await import('../../src/server/marketing/replyIntelligence.js');
    await processInboundReply(prisma, baseProspect, 'Please unsubscribe me from this list', 'office@downtown.ca');

    expect(prisma.prospect.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ optOutAt: expect.any(Date), stage: 'opted_out', sequenceCompleted: true }),
      }),
    );
  });

  it('regex fallback: recognizes "stop emailing" and "do not contact" phrasing', async () => {
    const { runGeminiJson } = await import('../../src/server/marketing/geminiClient.js');
    vi.mocked(runGeminiJson).mockResolvedValue(null);

    const prisma = mockPrisma();
    const { processInboundReply } = await import('../../src/server/marketing/replyIntelligence.js');
    await processInboundReply(prisma, baseProspect, 'Please stop emailing us, do not contact again', 'office@downtown.ca');

    expect(prisma.prospect.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stage: 'opted_out' }),
      }),
    );
  });

  it('regex fallback: a positive reply is not misclassified as unsubscribe', async () => {
    const { runGeminiJson } = await import('../../src/server/marketing/geminiClient.js');
    vi.mocked(runGeminiJson).mockResolvedValue(null);

    const prisma = mockPrisma();
    const { processInboundReply } = await import('../../src/server/marketing/replyIntelligence.js');
    await processInboundReply(prisma, baseProspect, "Sounds good, let's talk", 'office@downtown.ca');

    const optOutCall = vi.mocked(prisma.prospect.update).mock.calls.find(
      ([arg]) => (arg as { data: Partial<Prospect> }).data.stage === 'opted_out',
    );
    expect(optOutCall).toBeUndefined();
  });

  it('AI path: opts out when Gemini classifies the reply as unsubscribe', async () => {
    const { runGeminiJson } = await import('../../src/server/marketing/geminiClient.js');
    vi.mocked(runGeminiJson).mockResolvedValue({
      intent: 'unsubscribe',
      summary: 'Practice asked to be removed from the list',
    });

    const prisma = mockPrisma();
    const { processInboundReply } = await import('../../src/server/marketing/replyIntelligence.js');
    // Wording alone would not match the regex fallback — only the mocked AI classification does.
    await processInboundReply(prisma, baseProspect, 'kindly take us off your mailing list please', 'office@downtown.ca');

    expect(prisma.prospect.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stage: 'opted_out' }),
      }),
    );
  });

  it('does nothing when the prospect has already opted out', async () => {
    const prisma = mockPrisma({ optOutAt: new Date() });
    const { processInboundReply } = await import('../../src/server/marketing/replyIntelligence.js');
    await processInboundReply(prisma, { ...baseProspect, optOutAt: new Date() }, 'unsubscribe', 'office@downtown.ca');

    expect(prisma.prospect.update).not.toHaveBeenCalled();
  });
});
