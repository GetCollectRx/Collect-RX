import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient, Prospect } from '@prisma/client';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertProspectCallable, checkProspectDncl } from '../../src/server/marketing/dnclCheck.js';

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
  emailOpenCount: 0,
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
      update: vi.fn().mockResolvedValue(prospect),
    },
    prospectActivity: {
      create: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient;
}

describe('checkProspectDncl', () => {
  afterEach(() => {
    delete process.env.DNCL_PHONE_LIST_PATH;
    delete process.env.DNCL_CHECK_URL;
    delete process.env.DNCL_CHECK_API_KEY;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('skips numbers with no phone on file', async () => {
    const prisma = mockPrisma();
    const result = await checkProspectDncl(prisma, { ...baseProspect, phone: null });
    expect(result).toEqual({ listed: null, source: 'skipped' });
    expect(prisma.prospect.update).not.toHaveBeenCalled();
  });

  it('returns cached result without re-checking when already checked', async () => {
    const prisma = mockPrisma();
    const result = await checkProspectDncl(prisma, {
      ...baseProspect,
      dnclCheckedAt: new Date(),
      dnclListed: true,
    });
    expect(result).toEqual({ listed: true, source: 'cache' });
    expect(prisma.prospect.update).not.toHaveBeenCalled();
  });

  it('blocks a number present on the local DNCL file — checked before any outbound call', async () => {
    const listPath = join(tmpdir(), `dncl-test-${Date.now()}-${Math.random()}.txt`);
    writeFileSync(listPath, '4165550100\n');
    process.env.DNCL_PHONE_LIST_PATH = listPath;

    const prisma = mockPrisma();
    const result = await checkProspectDncl(prisma, baseProspect);
    expect(result.listed).toBe(true);
    expect(result.source).toBe('local_file');
    expect(prisma.prospect.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: baseProspect.id },
        data: expect.objectContaining({ dnclListed: true }),
      }),
    );
    expect(prisma.prospectActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'dncl_listed' }),
      }),
    );

    unlinkSync(listPath);
  });

  it('clears a number absent from the local DNCL file', async () => {
    const listPath = join(tmpdir(), `dncl-test-${Date.now()}-${Math.random()}.txt`);
    writeFileSync(listPath, '6135550199\n');
    process.env.DNCL_PHONE_LIST_PATH = listPath;

    const prisma = mockPrisma();
    const result = await checkProspectDncl(prisma, baseProspect);
    expect(result.listed).toBe(false);
    expect(result.source).toBe('local_file');

    unlinkSync(listPath);
  });

  it('falls back to the DNCL API when no local file is configured', async () => {
    process.env.DNCL_CHECK_URL = 'https://dncl.example.test/check';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ listed: true }),
      }),
    );

    const prisma = mockPrisma();
    const result = await checkProspectDncl(prisma, baseProspect);
    expect(result).toEqual({ listed: true, source: 'api' });
  });
});

describe('assertProspectCallable', () => {
  afterEach(() => {
    delete process.env.DNCL_PHONE_LIST_PATH;
    delete process.env.DNCL_STRICT;
    delete process.env.NODE_ENV;
  });

  it('throws before placing a call to a number on the DNCL', async () => {
    const listPath = join(tmpdir(), `dncl-test-${Date.now()}-${Math.random()}.txt`);
    writeFileSync(listPath, '4165550100\n');
    process.env.DNCL_PHONE_LIST_PATH = listPath;

    const prisma = mockPrisma();
    await expect(assertProspectCallable(prisma, baseProspect)).rejects.toThrow(
      /National Do Not Call List/,
    );

    unlinkSync(listPath);
  });

  it('allows the call when the number is clear', async () => {
    const listPath = join(tmpdir(), `dncl-test-${Date.now()}-${Math.random()}.txt`);
    writeFileSync(listPath, '6135550199\n');
    process.env.DNCL_PHONE_LIST_PATH = listPath;

    const prisma = mockPrisma();
    await expect(assertProspectCallable(prisma, baseProspect)).resolves.toBeUndefined();

    unlinkSync(listPath);
  });

  it('does not block calls outside production when no checker is configured', async () => {
    process.env.NODE_ENV = 'test';
    const prisma = mockPrisma();
    await expect(assertProspectCallable(prisma, baseProspect)).resolves.toBeUndefined();
  });

  it('refuses to place calls in production when no DNCL checker is configured', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DNCL_STRICT = 'true';
    const prisma = mockPrisma();
    await expect(assertProspectCallable(prisma, baseProspect)).rejects.toThrow(
      /DNCL check not configured/,
    );
  });
});
