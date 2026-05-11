import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { processEmrSyncOutboxBatch } from '../../src/server/emrSyncOutbox';

const row = {
  id: 'out-1',
  practiceId: 'pr-1',
  claimId: 'cl-1',
  eventType: 'CLAIM_RESOLVED',
  payloadJson: { x: 1 } as object,
  createdAt: new Date('2026-01-01T12:00:00Z'),
};

describe('processEmrSyncOutboxBatch', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '',
      } as Response),
    );
    delete process.env.EMR_SYNC_WEBHOOK_URL;
    delete process.env.EMR_SYNC_WEBHOOK_SECRET;
    delete process.env.EMR_OUTBOX_DEV_ACK;
    delete process.env.EMR_OUTBOX_BATCH_SIZE;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns zeros when nothing pending', async () => {
    const prisma = {
      emrSyncOutbox: {
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
      },
    } as unknown as PrismaClient;
    const r = await processEmrSyncOutboxBatch(prisma);
    expect(r).toEqual({ pulled: 0, markedProcessed: 0, deliveryFailed: 0 });
  });

  it('does not mark rows when no webhook and no dev ack', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const prisma = {
      emrSyncOutbox: {
        findMany: vi.fn().mockResolvedValue([row]),
        update: vi.fn(),
      },
    } as unknown as PrismaClient;
    const r = await processEmrSyncOutboxBatch(prisma);
    expect(r.markedProcessed).toBe(0);
    expect(r.pulled).toBe(1);
    expect(prisma.emrSyncOutbox.update).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('marks rows with dev ack when webhook URL unset', async () => {
    process.env.EMR_OUTBOX_DEV_ACK = '1';
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      emrSyncOutbox: {
        findMany: vi.fn().mockResolvedValue([row]),
        update,
      },
    } as unknown as PrismaClient;
    const r = await processEmrSyncOutboxBatch(prisma);
    expect(r.markedProcessed).toBe(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'out-1' },
      data: { processedAt: expect.any(Date) },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('POSTs to webhook and marks on 2xx', async () => {
    process.env.EMR_SYNC_WEBHOOK_URL = 'https://bridge.example/emr';
    process.env.EMR_SYNC_WEBHOOK_SECRET = 'secret';
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      emrSyncOutbox: {
        findMany: vi.fn().mockResolvedValue([row]),
        update,
      },
    } as unknown as PrismaClient;
    const r = await processEmrSyncOutboxBatch(prisma);
    expect(r.markedProcessed).toBe(1);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://bridge.example/emr');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)?.Authorization).toBe('Bearer secret');
    const parsed = JSON.parse((init?.body as string) ?? '{}');
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.eventType).toBe('CLAIM_RESOLVED');
    expect(update).toHaveBeenCalled();
  });

  it('does not mark row when webhook returns error', async () => {
    process.env.EMR_SYNC_WEBHOOK_URL = 'https://bridge.example/emr';
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'boom',
    } as Response);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      emrSyncOutbox: {
        findMany: vi.fn().mockResolvedValue([row]),
        update,
      },
    } as unknown as PrismaClient;
    const r = await processEmrSyncOutboxBatch(prisma);
    expect(r.markedProcessed).toBe(0);
    expect(r.deliveryFailed).toBe(1);
    expect(update).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
