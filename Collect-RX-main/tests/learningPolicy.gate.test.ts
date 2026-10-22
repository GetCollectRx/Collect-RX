import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const logSpy = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('../src/server/observability/logger.js', () => ({ logger: logSpy }));

import { extractLessonsFromCall, getApprovedNavigationNotes } from '../src/server/learning/carrierLessons.js';
import { getPracticeCarrierIntelligenceFeed } from '../src/server/learning/practiceCarrierFeed.js';
import {
  getKnownSubmissionChannel,
  recordSubmissionChannelObservation,
} from '../src/server/learning/submissionChannelMemory.js';
import {
  PROVENANCE_RETENTION_ENV,
  readProvenanceRetentionDays,
  runLessonProvenanceExpiry,
} from '../src/server/learning/provenanceExpiry.js';

const PRACTICE_ID = 'practice-synthetic-learning';
const CALL_ID = 'call-synthetic-learning';
const LONG_TRANSCRIPT = 'Synthetic transcript line. '.repeat(20);
const SYNTHETIC_NAME_LESSON = 'The rep Jordan Alvarez always asks for the provider number first.';
const CLEAN_LESSON = 'This carrier asks for the provider number before discussing any claim.';

interface PracticeFlags {
  learningContribution: boolean;
  learningConsumption: boolean;
}

function fakePrisma(flags: PracticeFlags, options: { lessonRows?: unknown[] } = {}) {
  const spies = {
    callAttemptFindUnique: vi.fn(async (args: { select: Record<string, unknown> }) => {
      if ('claim' in args.select) {
        return { claim: { carrierId: 'sun_life', practiceId: PRACTICE_ID } };
      }
      return { transcriptText: LONG_TRANSCRIPT };
    }),
    lessonCount: vi.fn(async () => 0),
    lessonFindMany: vi.fn(async () => options.lessonRows ?? []),
    lessonCreate: vi.fn(async () => ({ id: 'lesson-synthetic' })),
    lessonUpdateMany: vi.fn(async () => ({ count: 0 })),
    channelFindUnique: vi.fn(async () => null),
    channelUpsert: vi.fn(async () => ({})),
    practiceFindUnique: vi.fn(async () => ({
      name: 'Synthetic Learning Practice',
      billingPhone: null,
      faxNumber: null,
      npi: null,
      taxId: null,
      ...flags,
    })),
    practiceFindMany: vi.fn(async () => []),
  };
  const prisma = {
    callAttempt: { findUnique: spies.callAttemptFindUnique },
    carrierLesson: {
      count: spies.lessonCount,
      findMany: spies.lessonFindMany,
      create: spies.lessonCreate,
      updateMany: spies.lessonUpdateMany,
    },
    carrierSubmissionChannel: { findUnique: spies.channelFindUnique, upsert: spies.channelUpsert },
    practice: { findUnique: spies.practiceFindUnique, findMany: spies.practiceFindMany },
  } as unknown as PrismaClient;
  return { prisma, spies };
}

function extractorResponse(lessons: unknown[]): Response {
  const body = { content: [{ type: 'text', text: JSON.stringify({ lessons }) }] };
  return new Response(JSON.stringify(body), { status: 200 });
}

describe('learning contribution (default-deny)', () => {
  const originalEnv = { ...process.env };
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'synthetic-test-key';
    process.env.COLLECTRX_ANTHROPIC_EVAL = '1';
    fetchSpy = vi.fn(async () => extractorResponse([]));
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
  });

  it('opted-out practice: no transcript read, zero model calls, zero lesson rows', async () => {
    const { prisma, spies } = fakePrisma({ learningContribution: false, learningConsumption: false });
    const stored = await extractLessonsFromCall(prisma, CALL_ID);
    expect(stored).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(spies.lessonCreate).not.toHaveBeenCalled();
    expect(spies.callAttemptFindUnique).toHaveBeenCalledTimes(1);
    expect(logSpy.info).toHaveBeenCalledWith(
      '[carrierLessons] skipped',
      expect.objectContaining({ reasonCode: 'LEARNING_CONTRIBUTION_DISABLED' }),
    );
  });

  it('opted-in practice: a lesson naming a person is rejected and only the reason code is logged', async () => {
    fetchSpy.mockResolvedValueOnce(extractorResponse([
      { category: 'REP_INTERACTION', observation: SYNTHETIC_NAME_LESSON, recommendation: 'Ask early.', confidence: 0.9 },
    ]));
    const { prisma, spies } = fakePrisma({ learningContribution: true, learningConsumption: false });
    const stored = await extractLessonsFromCall(prisma, CALL_ID);
    expect(stored).toBe(0);
    expect(spies.lessonCreate).not.toHaveBeenCalled();
    expect(logSpy.warn).toHaveBeenCalledWith(
      '[carrierLessons] lesson rejected by text scan',
      expect.objectContaining({ reasonCode: 'PERSON_NAME_PATTERN' }),
    );
    const everythingLogged = JSON.stringify(logSpy.warn.mock.calls);
    expect(everythingLogged).not.toContain('Alvarez');
    expect(everythingLogged).not.toContain('Jordan');
  });

  it('opted-in practice: a clean carrier-behaviour lesson is stored as PROPOSED provenance', async () => {
    fetchSpy.mockResolvedValueOnce(extractorResponse([
      { category: 'REP_INTERACTION', observation: CLEAN_LESSON, recommendation: 'Give the provider number first.', confidence: 0.8 },
    ]));
    const { prisma, spies } = fakePrisma({ learningContribution: true, learningConsumption: false });
    const stored = await extractLessonsFromCall(prisma, CALL_ID);
    expect(stored).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(spies.lessonCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ carrierId: 'sun_life', sourceCallAttemptId: CALL_ID }),
    });
  });

  it('opted-in practice: a lesson containing the practice name is rejected by fingerprint', async () => {
    fetchSpy.mockResolvedValueOnce(extractorResponse([
      {
        category: 'IVR_NAVIGATION',
        observation: 'Calls from synthetic learning practice get routed to the provider line.',
        recommendation: 'Press 2 for provider services.',
        confidence: 0.7,
      },
    ]));
    const { prisma, spies } = fakePrisma({ learningContribution: true, learningConsumption: false });
    await extractLessonsFromCall(prisma, CALL_ID);
    expect(spies.lessonCreate).not.toHaveBeenCalled();
    expect(logSpy.warn).toHaveBeenCalledWith(
      '[carrierLessons] lesson rejected by text scan',
      expect.objectContaining({ reasonCode: 'PRACTICE_FINGERPRINT' }),
    );
  });

  it('consumption off: navigation notes are empty and no lesson rows are read', async () => {
    const { prisma, spies } = fakePrisma({ learningContribution: false, learningConsumption: false });
    expect(await getApprovedNavigationNotes(prisma, 'sun_life', PRACTICE_ID)).toBe('');
    expect(spies.lessonFindMany).not.toHaveBeenCalled();
  });

  it('consumption on: approved navigation notes are returned', async () => {
    const { prisma } = fakePrisma(
      { learningContribution: false, learningConsumption: true },
      { lessonRows: [{ recommendation: 'Press 3 for claims.' }] },
    );
    expect(await getApprovedNavigationNotes(prisma, 'sun_life', PRACTICE_ID)).toBe(' | LEARNED: Press 3 for claims.');
  });

  it('consumption off: practice carrier feed is empty and approved lessons are not read', async () => {
    const { prisma, spies } = fakePrisma({ learningContribution: true, learningConsumption: false });
    expect(await getPracticeCarrierIntelligenceFeed(prisma, PRACTICE_ID)).toEqual([]);
    expect(spies.lessonFindMany).not.toHaveBeenCalled();
  });

  it('contribution off: submission channel observations are not written', async () => {
    const { prisma, spies } = fakePrisma({ learningContribution: false, learningConsumption: true });
    await recordSubmissionChannelObservation(prisma, {
      practiceId: PRACTICE_ID,
      carrierId: 'sun_life',
      channelType: 'CLAIM_RESUBMISSION',
      submissionMethod: 'fax',
      submissionDestination: 'synthetic destination',
    });
    expect(spies.channelUpsert).not.toHaveBeenCalled();
  });

  it('consumption off: known submission channel is empty', async () => {
    const { prisma, spies } = fakePrisma({ learningContribution: true, learningConsumption: false });
    expect(await getKnownSubmissionChannel(prisma, 'sun_life', 'CLAIM_RESUBMISSION', PRACTICE_ID)).toBe('');
    expect(spies.channelFindUnique).not.toHaveBeenCalled();
  });
});

describe('provenance expiry', () => {
  it('dry run reports counts and writes nothing', async () => {
    const { prisma, spies } = fakePrisma({ learningContribution: true, learningConsumption: true });
    const result = await runLessonProvenanceExpiry(prisma, { retentionDays: 365 });
    expect(result.dryRun).toBe(true);
    expect(result.cleared).toBe(0);
    expect(spies.lessonUpdateMany).not.toHaveBeenCalled();
  });

  it('live run clears only approved lessons older than the cutoff', async () => {
    const { prisma, spies } = fakePrisma({ learningContribution: true, learningConsumption: true });
    const now = new Date('2026-10-13T00:00:00Z');
    await runLessonProvenanceExpiry(prisma, { retentionDays: 30, dryRun: false, now });
    const args = spies.lessonUpdateMany.mock.calls[0] as unknown as [
      { where: { status: string; reviewedAt: { lt: Date } }; data: { sourceCallAttemptId: null } },
    ];
    expect(args[0].where.status).toBe('APPROVED');
    expect(args[0].where.reviewedAt.lt.toISOString()).toBe('2026-09-13T00:00:00.000Z');
    expect(args[0].data).toEqual({ sourceCallAttemptId: null });
  });

  it('retention period has no default and rejects non-positive values', () => {
    expect(() => readProvenanceRetentionDays({})).toThrow(PROVENANCE_RETENTION_ENV);
    expect(() => readProvenanceRetentionDays({ [PROVENANCE_RETENTION_ENV]: '0' })).toThrow();
    expect(readProvenanceRetentionDays({ [PROVENANCE_RETENTION_ENV]: '400' })).toBe(400);
  });
});
