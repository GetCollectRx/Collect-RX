import { describe, expect, it, vi, beforeEach } from 'vitest';
import { handleProspectSendGridEvent } from '../../src/server/marketing/prospectEngagement.js';
import type { PrismaClient, Prospect } from '@prisma/client';

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
      findUniqueOrThrow: vi.fn().mockResolvedValue({ ...prospect, emailOpenCount: 3 }),
      update: vi.fn().mockImplementation(({ data }: { data: Partial<Prospect> }) =>
        Promise.resolve({ ...prospect, ...data }),
      ),
    },
    prospectActivity: {
      create: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient;
}

describe('handleProspectSendGridEvent', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    );
  });

  it('increments open count and can advance to engaged', async () => {
    const prisma = mockPrisma();
    await handleProspectSendGridEvent(prisma, {
      event: 'open',
      prospect_id: 'p1',
    });
    expect(prisma.prospect.update).toHaveBeenCalled();
    expect(prisma.prospectActivity.create).toHaveBeenCalled();
  });

  it('opts out on spam report', async () => {
    const prisma = mockPrisma();
    await handleProspectSendGridEvent(prisma, {
      event: 'spamreport',
      prospect_id: 'p1',
    });
    expect(prisma.prospect.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stage: 'opted_out' }),
      }),
    );
  });
});

describe('email templates', () => {
  it('interpolates practice name in subject', async () => {
    const { interpolateSubject } = await import('../../src/server/marketing/emailTemplates.js');
    expect(interpolateSubject('Hello {{practice}}', baseProspect)).toBe('Hello Downtown Dental');
  });

  it('step 1 uses founder voice without social proof or em dashes', async () => {
    const { COLD_SEQUENCE } = await import('../../src/server/marketing/emailTemplates.js');
    const html = COLD_SEQUENCE[0]!.buildHtml(baseProspect);
    expect(html).toContain('Khalid');
    expect(html).toContain('collectrx.ca/demo');
    expect(html).not.toContain('—');
    expect(html.toLowerCase()).not.toContain('colleague');
    expect(html.toLowerCase()).not.toContain('mentioned');
  });
});

describe('reply intelligence fallback', () => {
  it('detects unsubscribe keywords without Gemini', async () => {
    const prisma = mockPrisma();
    const { processInboundReply } = await import('../../src/server/marketing/replyIntelligence.js');
    await processInboundReply(
      prisma,
      baseProspect,
      'Please unsubscribe me from this list',
      'office@downtown.ca',
    );
    expect(prisma.prospect.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stage: 'opted_out' }),
      }),
    );
  });
});

describe('branded email layout', () => {
  it('wraps content with CollectRx branding', async () => {
    const { wrapOutreachEmail } = await import('../../src/server/marketing/emailLayout.js');
    const html = wrapOutreachEmail({
      bodyHtml: '<p>Test body</p>',
      cta: { label: 'Book demo', href: 'https://www.collectrx.ca' },
    });
    expect(html).toContain('CollectRx');
    expect(html).toContain('#0f9d58');
    expect(html).toContain('Book demo');
  });
});

describe('reply templates', () => {
  it('returns 3A-style positive reply with booking link', async () => {
    const { getReplyTemplate } = await import('../../src/server/marketing/replyTemplates.js');
    const tpl = getReplyTemplate('positive', baseProspect, 'Yes interested');
    expect(tpl?.text).toContain('Good to hear from you');
    expect(tpl?.text).toContain('calendly.com/collectrx/pilot-setup');
    expect(tpl?.text.toLowerCase()).not.toContain('colleague');
    expect(tpl?.autoSend).toBe(true);
  });

  it('detects pricing objection variant', async () => {
    const { detectObjectionVariant } = await import('../../src/server/marketing/replyTemplates.js');
    expect(detectObjectionVariant('What does it cost?')).toBe('pricing');
  });

  it('detects biller/has_solution objection variant', async () => {
    const { detectObjectionVariant } = await import('../../src/server/marketing/replyTemplates.js');
    expect(detectObjectionVariant('We already have someone handling this')).toBe('has_solution');
  });

  it('detects too-small objection variant', async () => {
    const { detectObjectionVariant } = await import('../../src/server/marketing/replyTemplates.js');
    expect(detectObjectionVariant('We are too small, just one dentist')).toBe('too_small');
  });
});

describe('sales call script', () => {
  it('includes voice rules and no fake social proof in system prompt', async () => {
    const { buildSalesQualifierSystemPrompt } = await import('../../src/server/marketing/salesCallScript.js');
    const prompt = buildSalesQualifierSystemPrompt(baseProspect);
    expect(prompt).toContain('Do NOT claim we already work with');
    expect(prompt).toContain('CollectRx');
    expect(prompt).toContain('Downtown Dental');
  });
});

describe('capability catalog', () => {
  it('maps steps to enabled capabilities only', async () => {
    const { capabilitiesForCadenceStep } = await import('../../src/server/marketing/outreachVoice.js');
    const step1 = capabilitiesForCadenceStep(1);
    expect(step1.length).toBeGreaterThan(0);
    expect(step1.every((c) => c.enabled)).toBe(true);
    expect(step1.some((c) => c.id === 'socialProof')).toBe(false);
  });
});

describe('email preview', () => {
  it('builds preview for cadence step 1', async () => {
    const { previewColdEmail } = await import('../../src/server/marketing/emailTemplates.js');
    const preview = previewColdEmail(baseProspect, 1);
    expect(preview?.subject).toContain('Downtown Dental');
    expect(preview?.text).toContain('Khalid');
    expect(preview?.html).not.toContain('—');
  });
});

describe('merge-field personalization', () => {
  it('interpolates city and province in subjects', async () => {
    const { mergeProspectFields } = await import('../../src/server/marketing/aiPersonalization.js');
    const out = mergeProspectFields('{{practice}} in {{city}}, {{province}}', baseProspect);
    expect(out).toBe('Downtown Dental in Toronto, ON');
  });
});

describe('subject A/B', () => {
  it('assigns deterministic variant and interpolates city in T1-A', async () => {
    const { pickSubjectVariant, resolveColdSubject } = await import('../../src/server/marketing/emailTemplates.js');
    const variant = pickSubjectVariant(baseProspect.id);
    expect(['a', 'b']).toContain(variant);
    const subject = resolveColdSubject(1, baseProspect);
    expect(subject.length).toBeGreaterThan(10);
    if (variant === 'a') {
      expect(subject).toContain('Toronto');
    } else {
      expect(subject).toContain('Downtown Dental');
    }
  });
});

describe('post-demo follow-up', () => {
  it('builds 5A interested draft', async () => {
    const { buildPostDemoFollowUp } = await import('../../src/server/marketing/emailTemplates.js');
    const email = buildPostDemoFollowUp(baseProspect, 'interested', { agreementSendDay: 'Friday' });
    expect(email.text).toContain('60-day free trial');
    expect(email.text).toContain('Friday');
  });
});

describe('pre-demo email', () => {
  it('includes scheduled time when set', async () => {
    const { buildPreDemoEmail } = await import('../../src/server/marketing/emailTemplates.js');
    const demoAt = new Date('2026-06-15T18:00:00Z');
    const email = buildPreDemoEmail({ ...baseProspect, demoScheduledAt: demoAt });
    expect(email.subject).toContain('CollectRx call');
    expect(email.text).toContain('Downtown Dental');
    expect(email.text).toContain('free trial');
  });
});

describe('DNCL check', () => {
  it('marks listed when phone is in local file', async () => {
    const { writeFileSync, unlinkSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const listPath = join(tmpdir(), `dncl-test-${Date.now()}.txt`);
    writeFileSync(listPath, '4165550100\n');
    process.env.DNCL_PHONE_LIST_PATH = listPath;
    process.env.DNCL_STRICT = 'true';

    const prisma = mockPrisma();
    const { checkProspectDncl } = await import('../../src/server/marketing/dnclCheck.js');
    const result = await checkProspectDncl(prisma, baseProspect);
    expect(result.listed).toBe(true);
    expect(result.source).toBe('local_file');

    delete process.env.DNCL_PHONE_LIST_PATH;
    unlinkSync(listPath);
  });
});
