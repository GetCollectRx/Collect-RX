import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  claimVapiWebhookForProcessing,
  markVapiWebhookFailed,
  markWebhookProcessed,
} from '../src/server/vapi/vapiWebhook.js';

function lifecyclePrisma(overrides: {
  create?: ReturnType<typeof vi.fn>;
  findUnique?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
  updateMany?: ReturnType<typeof vi.fn>;
}): PrismaClient {
  return {
    processedVapiWebhook: {
      create: overrides.create ?? vi.fn().mockResolvedValue({}),
      findUnique: overrides.findUnique ?? vi.fn().mockResolvedValue(null),
      update: overrides.update ?? vi.fn().mockResolvedValue({}),
      updateMany: overrides.updateMany ?? vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient;
}

describe('Vapi webhook delivery lifecycle', () => {
  it('claims a received delivery before processing', async () => {
    const create = vi.fn().mockResolvedValue({});
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const client = lifecyclePrisma({ create, updateMany });
    const now = new Date('2026-07-12T20:00:00.000Z');

    await expect(claimVapiWebhookForProcessing(client, 'body-hash', now)).resolves.toEqual({
      state: 'claimed',
    });
    expect(create).toHaveBeenCalledWith({
      data: { bodyHash: 'body-hash', status: 'received' },
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          bodyHash: 'body-hash',
          OR: expect.arrayContaining([
            { status: { in: ['received', 'failed'] } },
          ]),
        }),
        data: expect.objectContaining({
          status: 'processing',
          processingStartedAt: now,
          attemptCount: { increment: 1 },
        }),
      }),
    );
  });

  it('does not reprocess a completed delivery', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const client = lifecyclePrisma({
      updateMany,
      findUnique: vi.fn().mockResolvedValue({ status: 'processed' }),
    });

    await expect(claimVapiWebhookForProcessing(client, 'body-hash')).resolves.toEqual({
      state: 'processed',
    });
    expect(updateMany).toHaveBeenCalledOnce();
  });

  it('returns a retryable in-progress state for an active lease', async () => {
    const client = lifecyclePrisma({
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findUnique: vi.fn().mockResolvedValue({ status: 'processing' }),
    });

    await expect(claimVapiWebhookForProcessing(client, 'body-hash')).resolves.toEqual({
      state: 'processing',
    });
  });

  it('records failure without retaining a processing error or payload', async () => {
    const update = vi.fn().mockResolvedValue({});
    const client = lifecyclePrisma({ update });

    await markVapiWebhookFailed(client, 'body-hash');

    expect(update).toHaveBeenCalledWith({
      where: { bodyHash: 'body-hash' },
      data: expect.objectContaining({ status: 'failed', failedAt: expect.any(Date) }),
    });
    expect(JSON.stringify(update.mock.calls[0])).not.toContain('payload');
  });

  it('marks a successful delivery processed only after caller completion', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const client = lifecyclePrisma({});
    Object.assign(client.processedVapiWebhook, { upsert });

    await markWebhookProcessed(client, 'body-hash');

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { bodyHash: 'body-hash' },
      update: expect.objectContaining({ status: 'processed', processedAt: expect.any(Date) }),
    }));
  });
});
