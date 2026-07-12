import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  extractLessonsFromCall,
  getApprovedNavigationNotes,
} from '../src/server/learning/carrierLessons.js';
import { probeClaimStatus } from '../src/server/triage/claimStatusProbe.js';
import { shouldProposeLessons } from '../src/webhooks/vapiNormalizer.js';

function anthropicResponse(lessons: unknown) {
  return {
    ok: true,
    json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ lessons }) }] }),
  };
}

function lessonPrisma(overrides: Record<string, unknown> = {}) {
  const created: Array<Record<string, unknown>> = [];
  const prisma = {
    callAttempt: {
      findUnique: vi.fn().mockResolvedValue({
        transcriptText: 'x'.repeat(300),
        claim: { carrierId: 'rbc' },
      }),
    },
    carrierLesson: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return data;
      }),
      ...overrides,
    },
  };
  return { prisma: prisma as unknown as PrismaClient, created };
}

describe('extractLessonsFromCall', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stores well-formed lessons as PROPOSED-shaped rows', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(anthropicResponse([
      {
        category: 'IVR_NAVIGATION',
        observation: 'Menu offers a fax-back option at the claim status step',
        recommendation: 'Press two at the claim status menu for automated fax-back',
        confidence: 0.8,
      },
    ])));
    const { prisma, created } = lessonPrisma();
    const stored = await extractLessonsFromCall(prisma, 'attempt-1');
    expect(stored).toBe(1);
    expect(created[0].carrierId).toBe('rbc');
    expect(created[0].sourceCallAttemptId).toBe('attempt-1');
  });

  it('rejects lessons containing identifier-like content despite instructions', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(anthropicResponse([
      {
        category: 'REP_INTERACTION',
        observation: 'Rep confirmed policy 48217702 quickly',
        recommendation: 'Lead with the policy number',
        confidence: 0.9,
      },
    ])));
    const { prisma, created } = lessonPrisma();
    expect(await extractLessonsFromCall(prisma, 'attempt-1')).toBe(0);
    expect(created).toHaveLength(0);
  });

  it('dedupes against existing lessons and drops invalid categories', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(anthropicResponse([
      { category: 'IVR_NAVIGATION', observation: 'Known thing', recommendation: 'Do it', confidence: 0.7 },
      { category: 'MADE_UP', observation: 'New thing', recommendation: 'Do other', confidence: 0.7 },
    ])));
    const { prisma, created } = lessonPrisma({
      findMany: vi.fn().mockResolvedValue([{ observation: 'known thing' }]),
    });
    expect(await extractLessonsFromCall(prisma, 'attempt-1')).toBe(0);
    expect(created).toHaveLength(0);
  });

  it('skips calls with no usable transcript without calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { prisma } = lessonPrisma();
    (prisma.callAttempt.findUnique as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ transcriptText: 'short', claim: { carrierId: 'rbc' } });
    expect(await extractLessonsFromCall(prisma, 'attempt-1')).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('getApprovedNavigationNotes', () => {
  it('formats approved recommendations for the ivr instructions variable', async () => {
    const prisma = {
      carrierLesson: {
        findMany: vi.fn().mockResolvedValue([
          { recommendation: 'Press two for fax-back' },
          { recommendation: 'Say representative to skip the menu' },
        ]),
      },
    } as unknown as PrismaClient;
    const notes = await getApprovedNavigationNotes(prisma, 'rbc');
    expect(notes).toBe(' | LEARNED: Press two for fax-back | Say representative to skip the menu');
  });

  it('returns empty string when nothing is approved', async () => {
    const prisma = {
      carrierLesson: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;
    expect(await getApprovedNavigationNotes(prisma, 'rbc')).toBe('');
  });
});

describe('probeClaimStatus (pre-call triage)', () => {
  function triagePrisma(fresh: Record<string, unknown> | null) {
    return {
      insuranceClaim: { findUnique: vi.fn().mockResolvedValue(fresh) },
    } as unknown as PrismaClient;
  }
  const ref = { id: 'claim-1', practiceId: 'practice-1' };

  it('closes claims already RESOLVED in synced data', async () => {
    const r = await probeClaimStatus(triagePrisma({ status: 'RESOLVED', outstandingAmount: 100 }), ref);
    expect(r?.action).toBe('CLOSE_RESOLVED');
    expect(r?.channel).toBe('pms-sync');
  });

  it('closes claims whose outstanding amount reached zero', async () => {
    const r = await probeClaimStatus(triagePrisma({ status: 'IN_QUEUE', outstandingAmount: 0 }), ref);
    expect(r?.action).toBe('CLOSE_RESOLVED');
  });

  it('proceeds to dispatch when the claim still owes money', async () => {
    expect(await probeClaimStatus(triagePrisma({ status: 'IN_QUEUE', outstandingAmount: 450 }), ref)).toBeNull();
  });

  it('never blocks dispatch when a channel throws', async () => {
    const prisma = {
      insuranceClaim: { findUnique: vi.fn().mockRejectedValue(new Error('db down')) },
    } as unknown as PrismaClient;
    expect(await probeClaimStatus(prisma, ref)).toBeNull();
  });
});

describe('shouldProposeLessons (webhook gate)', () => {
  const endedCall = { id: 'call-1', status: 'ended' };

  it('proposes lessons from a failed call that has a transcript but no structured analysis', () => {
    expect(
      shouldProposeLessons({
        type: 'call.ended',
        call: endedCall,
        transcript: 'IVR: invalid option selected. Call terminated.',
      }),
    ).toBe(true);
  });

  it('proposes lessons from a successful call with full analysis', () => {
    expect(
      shouldProposeLessons({
        type: 'call.ended',
        call: endedCall,
        transcript: 'Rep confirmed the claim is in process.',
        analysis: { structuredData: { outcome: 'PROCESSING' } },
      }),
    ).toBe(true);
  });

  it('skips calls that produced no transcript', () => {
    expect(shouldProposeLessons({ type: 'call.ended', call: endedCall })).toBe(false);
  });

  it('skips non-terminal events even when a partial transcript is attached', () => {
    expect(
      shouldProposeLessons({
        type: 'status-update',
        call: { id: 'call-1', status: 'in-progress' },
        transcript: 'partial',
      }),
    ).toBe(false);
  });
});
