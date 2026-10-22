import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { schedule, validate } = vi.hoisted(() => ({ schedule: vi.fn(), validate: vi.fn(() => true) }));
vi.mock('node-cron', () => ({ default: { schedule, validate } }));

import {
  runHumanAssistedProfileSynthesis,
  synthesizeCarrierProfile,
} from '../../src/server/learning/humanAssistedProfiles.js';

type Log = { id: string; scenario: string; callSummary: string } & Record<string, string | null>;

function log(id: string, summary: string): Log {
  return {
    id,
    scenario: 'documentation_requested',
    shortfallReason: null,
    documentationRequested: 'periapical x-ray',
    submissionMethod: 'fax',
    denialOrReductionCode: null,
    callSummary: summary,
    unresolvedFields: null,
  };
}

function prismaWith(logs: Log[], existing: Array<{ id: string; observation: string; sampleSize: number; confidence: number }> = []) {
  return {
    humanAssistedCallLog: {
      findMany: vi.fn().mockResolvedValue(logs),
      updateMany: vi.fn().mockResolvedValue({ count: logs.length }),
      groupBy: vi.fn(),
    },
    humanAssistedCarrierProfile: {
      findMany: vi.fn().mockResolvedValue(existing),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

function anthropicReturns(profiles: unknown[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ profiles }) }] }),
  });
}

const twoLogs = [log('l1', 'Rep asked for a periapical x-ray'), log('l2', 'Rep asked for a periapical x-ray again')];

describe('synthesizeCarrierProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COLLECTRX_ANTHROPIC_EVAL = '1';
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.COLLECTRX_ANTHROPIC_EVAL;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('refuses to call the model unless paid LLM calls are explicitly enabled, and leaves the logs unprocessed', async () => {
    delete process.env.COLLECTRX_ANTHROPIC_EVAL;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const prisma = prismaWith(twoLogs);
    await expect(synthesizeCarrierProfile(prisma as never, 'sun_life')).rejects.toThrow(/Live Anthropic API calls are disabled/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.humanAssistedCallLog.updateMany).not.toHaveBeenCalled();
  });

  it('does nothing with fewer than two unprocessed calls, since one call is not a pattern', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const prisma = prismaWith([twoLogs[0]]);
    expect(await synthesizeCarrierProfile(prisma as never, 'sun_life')).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('only reads this carrier’s unprocessed logs, oldest first', async () => {
    vi.stubGlobal('fetch', anthropicReturns([]));
    const prisma = prismaWith(twoLogs);
    await synthesizeCarrierProfile(prisma as never, 'manulife');
    expect(prisma.humanAssistedCallLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { carrierId: 'manulife', processedForProfileAt: null }, orderBy: { createdAt: 'asc' } }),
    );
  });

  it('creates a profile for a new recurring pattern and marks every log in the batch processed', async () => {
    vi.stubGlobal(
      'fetch',
      anthropicReturns([
        { category: 'DOCUMENTATION', observation: 'Asks for periapical x-rays on crowns', recommendation: 'Attach x-rays up front', confidence: 0.8, supportingCallCount: 2 },
      ]),
    );
    const prisma = prismaWith(twoLogs);
    expect(await synthesizeCarrierProfile(prisma as never, 'sun_life')).toBe(1);
    expect(prisma.humanAssistedCarrierProfile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        carrierId: 'sun_life',
        category: 'DOCUMENTATION',
        sampleSize: 2,
        confidence: 0.8,
        lastCallLogId: 'l2',
      }),
    });
    expect(prisma.humanAssistedCallLog.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['l1', 'l2'] } },
      data: { processedForProfileAt: expect.any(Date) },
    });
  });

  it('strengthens an existing profile when the same pattern recurs, ignoring case and punctuation', async () => {
    vi.stubGlobal(
      'fetch',
      anthropicReturns([
        { category: 'DOCUMENTATION', observation: 'asks for periapical X-rays on crowns!', recommendation: 'Send x-rays with the claim', confidence: 0.6, supportingCallCount: 3 },
      ]),
    );
    const prisma = prismaWith(twoLogs, [{ id: 'p1', observation: 'Asks for periapical xrays on crowns', sampleSize: 4, confidence: 0.9 }]);
    await synthesizeCarrierProfile(prisma as never, 'sun_life');
    expect(prisma.humanAssistedCarrierProfile.create).not.toHaveBeenCalled();
    expect(prisma.humanAssistedCarrierProfile.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { sampleSize: 7, confidence: 0.9, recommendation: 'Send x-rays with the claim', lastCallLogId: 'l2' },
    });
  });

  it.each([
    ['a claim or reference number', 'Rep cited reference 12345678 every time'],
    ['a date', 'Paid on 2026-03-01 after resubmission'],
    ['a dollar amount', 'Reduced every crown by $150'],
  ])('drops a pattern that leaks %s', async (_label, observation) => {
    vi.stubGlobal(
      'fetch',
      anthropicReturns([{ category: 'DENIAL_PATTERN', observation, recommendation: 'n/a', confidence: 0.9, supportingCallCount: 2 }]),
    );
    const prisma = prismaWith(twoLogs);
    expect(await synthesizeCarrierProfile(prisma as never, 'sun_life')).toBe(0);
    expect(prisma.humanAssistedCarrierProfile.create).not.toHaveBeenCalled();
  });

  it('drops unknown categories and malformed entries, clamps confidence and keeps at most six patterns', async () => {
    const valid = (n: number) => ({ category: 'REP_BEHAVIOR', observation: `Pattern number ${'x'.repeat(n)}`, recommendation: 'r', confidence: 7, supportingCallCount: 0 });
    vi.stubGlobal(
      'fetch',
      anthropicReturns([
        { category: 'NOT_A_CATEGORY', observation: 'o', recommendation: 'r' },
        { category: 'REP_BEHAVIOR', observation: 42, recommendation: 'r' },
        null,
        ...Array.from({ length: 8 }, (_, i) => valid(i + 1)),
      ]),
    );
    const prisma = prismaWith(twoLogs);
    const touched = await synthesizeCarrierProfile(prisma as never, 'sun_life');
    // The first six raw entries include the three invalid ones, so three survive.
    expect(touched).toBe(3);
    for (const call of prisma.humanAssistedCarrierProfile.create.mock.calls) {
      expect(call[0].data.confidence).toBe(1);
      expect(call[0].data.sampleSize).toBe(1);
    }
  });

  it('treats a model reply with no JSON as no patterns, and still marks the batch processed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'No patterns found.' }] }) }));
    const prisma = prismaWith(twoLogs);
    expect(await synthesizeCarrierProfile(prisma as never, 'sun_life')).toBe(0);
    expect(prisma.humanAssistedCallLog.updateMany).toHaveBeenCalled();
  });

  it('throws on an API error without marking logs processed, so they are retried next run', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 529, text: async () => 'overloaded' }));
    const prisma = prismaWith(twoLogs);
    await expect(synthesizeCarrierProfile(prisma as never, 'sun_life')).rejects.toThrow(/HTTP 529/);
    expect(prisma.humanAssistedCallLog.updateMany).not.toHaveBeenCalled();
  });
});

describe('runHumanAssistedProfileSynthesis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.COLLECTRX_ANTHROPIC_EVAL;
  });

  it('only considers carriers with at least two unprocessed calls and keeps going when one carrier fails', async () => {
    const prisma = prismaWith(twoLogs);
    prisma.humanAssistedCallLog.groupBy.mockResolvedValue([{ carrierId: 'sun_life' }, { carrierId: 'manulife' }]);
    // Paid calls are disabled, so each carrier's synthesis throws; the run must not.
    await expect(runHumanAssistedProfileSynthesis(prisma as never)).resolves.toBeUndefined();
    expect(prisma.humanAssistedCallLog.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ having: { id: { _count: { gte: 2 } } } }),
    );
    expect(prisma.humanAssistedCallLog.findMany).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});

describe('startHumanAssistedProfileLoopInProcess', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    validate.mockReturnValue(true);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.HUMAN_ASSISTED_PROFILE_LOOP_ENABLED;
    delete process.env.HUMAN_ASSISTED_PROFILE_CRON;
  });

  async function freshModule() {
    return import('../../src/server/learning/humanAssistedProfiles.js');
  }

  it('schedules every 6 hours by default, and only once', async () => {
    const { startHumanAssistedProfileLoopInProcess } = await freshModule();
    startHumanAssistedProfileLoopInProcess({} as never);
    startHumanAssistedProfileLoopInProcess({} as never);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith('0 */6 * * *', expect.any(Function));
  });

  it('can be switched off by env', async () => {
    process.env.HUMAN_ASSISTED_PROFILE_LOOP_ENABLED = 'false';
    const { startHumanAssistedProfileLoopInProcess } = await freshModule();
    startHumanAssistedProfileLoopInProcess({} as never);
    expect(schedule).not.toHaveBeenCalled();
  });

  it('refuses an invalid cron expression', async () => {
    process.env.HUMAN_ASSISTED_PROFILE_CRON = 'not a cron';
    validate.mockReturnValue(false);
    const { startHumanAssistedProfileLoopInProcess } = await freshModule();
    startHumanAssistedProfileLoopInProcess({} as never);
    expect(schedule).not.toHaveBeenCalled();
  });
});
