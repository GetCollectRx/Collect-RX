import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient, Prospect } from '@prisma/client';
import { makeProspect } from '../factories/prospect.js';

vi.mock('../../src/server/marketing/geminiClient.js', () => ({
  runGeminiJson: vi.fn(),
}));

const baseProspect: Prospect = makeProspect({ emailOpenCount: 2 });

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
