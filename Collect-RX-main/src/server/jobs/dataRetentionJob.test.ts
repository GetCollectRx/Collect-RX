import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  isDataRetentionGloballyEnabled,
  runDataRetentionAcrossPractices,
  runDataRetentionForPractice,
} from './dataRetentionJob.js';

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    practice: { findUnique: vi.fn().mockResolvedValue({ settings: null }), findMany: vi.fn().mockResolvedValue([]) },
    insuranceClaim: { findMany: vi.fn().mockResolvedValue([]), delete: vi.fn() },
    callAttempt: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
    callQueue: { deleteMany: vi.fn() },
    callTranscriptLine: { deleteMany: vi.fn() },
    auditLog: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    phiAccessEvent: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    ...overrides,
  } as unknown as PrismaClient;
}

describe('isDataRetentionGloballyEnabled', () => {
  const original = process.env.DATA_RETENTION_ENABLED;
  afterEach(() => {
    process.env.DATA_RETENTION_ENABLED = original;
  });

  it('defaults to disabled', () => {
    delete process.env.DATA_RETENTION_ENABLED;
    expect(isDataRetentionGloballyEnabled()).toBe(false);
  });

  it('enables only on an explicit "1" or "true"', () => {
    process.env.DATA_RETENTION_ENABLED = '1';
    expect(isDataRetentionGloballyEnabled()).toBe(true);
    process.env.DATA_RETENTION_ENABLED = 'true';
    expect(isDataRetentionGloballyEnabled()).toBe(true);
    process.env.DATA_RETENTION_ENABLED = 'yes';
    expect(isDataRetentionGloballyEnabled()).toBe(false);
  });
});

describe('runDataRetentionForPractice', () => {
  it('is a no-op when the practice has not opted in (purgeEnabled defaults to false)', async () => {
    const prisma = mockPrisma();
    const result = await runDataRetentionForPractice(prisma, 'practice-1');
    expect(result.ran).toBe(false);
    expect(result.claimsPurged).toBe(0);
    expect(prisma.insuranceClaim.findMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
  });

  it('purges expired resolved claims and their call records when opted in', async () => {
    const prisma = mockPrisma({
      practice: {
        findUnique: vi.fn().mockResolvedValue({
          settings: { retention: { purgeEnabled: true, claimRetentionMonths: 12 } },
        }),
      },
      insuranceClaim: {
        findMany: vi.fn().mockResolvedValue([{ id: 'claim-1' }]),
        delete: vi.fn(),
      },
      callAttempt: {
        findMany: vi.fn().mockResolvedValue([{ vapiCallId: 'vapi-1' }]),
        deleteMany: vi.fn(),
      },
      callQueue: { deleteMany: vi.fn() },
      callTranscriptLine: { deleteMany: vi.fn() },
    });

    const result = await runDataRetentionForPractice(prisma, 'practice-1');

    expect(result.ran).toBe(true);
    expect(result.claimsPurged).toBe(1);
    expect(prisma.insuranceClaim.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ practiceId: 'practice-1', status: 'RESOLVED' }),
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('records a per-claim error and continues rather than aborting the whole practice', async () => {
    const prisma = mockPrisma({
      practice: {
        findUnique: vi.fn().mockResolvedValue({ settings: { retention: { purgeEnabled: true } } }),
      },
      insuranceClaim: {
        findMany: vi.fn().mockResolvedValue([{ id: 'claim-1' }, { id: 'claim-2' }]),
        delete: vi.fn(),
      },
      callAttempt: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
      callQueue: { deleteMany: vi.fn() },
      callTranscriptLine: { deleteMany: vi.fn() },
      $transaction: vi
        .fn()
        .mockRejectedValueOnce(new Error('FK violation'))
        .mockResolvedValueOnce([]),
    });

    const result = await runDataRetentionForPractice(prisma, 'practice-1');

    expect(result.claimsPurged).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('claim-1');
  });
});

describe('runDataRetentionAcrossPractices', () => {
  beforeEach(() => {
    process.env.DATA_RETENTION_ENABLED = '1';
  });
  afterEach(() => {
    delete process.env.DATA_RETENTION_ENABLED;
  });

  it('does nothing when the global flag is off, regardless of per-practice settings', async () => {
    delete process.env.DATA_RETENTION_ENABLED;
    const prisma = mockPrisma({
      practice: { findMany: vi.fn().mockResolvedValue([{ id: 'practice-1' }]) },
    });
    const results = await runDataRetentionAcrossPractices(prisma);
    expect(results).toEqual([]);
    expect(prisma.practice.findMany).not.toHaveBeenCalled();
  });

  it('continues to the next practice when one practice throws', async () => {
    const findUnique = vi
      .fn()
      .mockRejectedValueOnce(new Error('db down for practice-1'))
      .mockResolvedValueOnce({ settings: null });
    const prisma = mockPrisma({
      practice: {
        findMany: vi.fn().mockResolvedValue([{ id: 'practice-1' }, { id: 'practice-2' }]),
        findUnique,
      },
    });
    const results = await runDataRetentionAcrossPractices(prisma);
    expect(results).toHaveLength(2);
    expect(results[0].errors[0]).toContain('db down for practice-1');
    expect(results[1].ran).toBe(false);
  });
});
