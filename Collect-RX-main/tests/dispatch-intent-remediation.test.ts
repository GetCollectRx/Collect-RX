import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  confirmDispatch,
  ensureDispatchIntent,
  markDispatchSending,
  reconcileStaleDispatchIntents,
  recordAmbiguousDispatch,
} from '../src/server/frontDesk/dispatchIntent.js';

describe('durable call dispatch boundary', () => {
  it('persists intent before external dispatch', async () => {
    const order: string[] = [];
    const prisma = {
      callDispatchIntent: {
        upsert: vi.fn(async ({ create }) => { order.push('intent'); return { id: 'i1', ...create }; }),
        update: vi.fn(async () => { order.push('sending'); return { id: 'i1' }; }),
      },
    } as unknown as PrismaClient;
    const externalDispatch = vi.fn(async () => { order.push('external'); });
    const intent = await ensureDispatchIntent(prisma, {
      practiceId: 'p1', claimId: 'c1', queueEntryId: 'q1', attemptNumber: 1,
    });
    await markDispatchSending(prisma, intent.id);
    await externalDispatch();
    expect(order).toEqual(['intent', 'sending', 'external']);
    expect(intent.idempotencyKey).toBe('carrier-call:q1:1');
  });

  it('ambiguous outcome blocks the queue and cannot schedule an automatic redial', async () => {
    const updates: unknown[] = [];
    const prisma = {
      callDispatchIntent: { update: vi.fn((args) => { updates.push(args); return Promise.resolve({}); }) },
      callQueue: { update: vi.fn((args) => { updates.push(args); return Promise.resolve({}); }) },
      $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    } as unknown as PrismaClient;
    await recordAmbiguousDispatch(prisma, { intentId: 'i1', queueEntryId: 'q1', failureCode: 'TIMEOUT' });
    expect(updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ data: expect.objectContaining({ status: 'AMBIGUOUS' }) }),
      expect.objectContaining({ data: expect.objectContaining({ status: 'BLOCKED' }) }),
    ]));
    expect(JSON.stringify(updates)).not.toContain('scheduledFor');
  });

  it('confirmed dispatch attaches intent, attempt, claim, and queue in one transaction', async () => {
    const tx = {
      callDispatchIntent: { update: vi.fn(async () => ({ id: 'i1' })) },
      callAttempt: { create: vi.fn(async () => ({ id: 'a1' })) },
      insuranceClaim: { update: vi.fn(async () => ({})) },
      callQueue: { update: vi.fn(async () => ({})) },
    };
    const prisma = { $transaction: vi.fn(async (fn) => fn(tx)) } as unknown as PrismaClient;
    const attempt = await confirmDispatch(prisma, {
      intentId: 'i1', queueEntryId: 'q1', claimId: 'c1', vapiCallId: 'v1',
    });
    expect(attempt.id).toBe('a1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.callAttempt.create).toHaveBeenCalledWith({ data: expect.objectContaining({ dispatchIntentId: 'i1' }) });
    expect(tx.callQueue.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'IN_PROGRESS' }) }));
  });

  it('restart reconciliation expires safe pre-send intents and holds uncertain sends', async () => {
    const intentUpdate = vi.fn(async () => ({}));
    const queueUpdate = vi.fn(async () => ({}));
    const prisma = {
      callDispatchIntent: {
        findMany: vi.fn(async () => [
          { id: 'ready', queueEntryId: 'q-ready', status: 'READY' },
          { id: 'sending', queueEntryId: 'q-sending', status: 'SENDING' },
        ]),
        update: intentUpdate,
      },
      callQueue: { update: queueUpdate },
      $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    } as unknown as PrismaClient;
    const result = await reconcileStaleDispatchIntents(prisma, new Date('2026-09-20T12:00:00Z'));
    expect(result).toEqual({ safeExpired: 1, heldAmbiguous: 1 });
    expect(intentUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'ready', status: 'READY' },
      data: expect.objectContaining({ failureCode: 'EXPIRED_BEFORE_SEND' }),
    }));
    expect(queueUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'BLOCKED' }) }));
  });

  it('recycles only a safely failed intent with the same idempotency key', async () => {
    const update = vi.fn(async () => ({
      id: 'i1', status: 'READY', idempotencyKey: 'carrier-call:q1:1',
    }));
    const prisma = {
      callDispatchIntent: {
        upsert: vi.fn(async () => ({
          id: 'i1', status: 'FAILED', idempotencyKey: 'carrier-call:q1:1',
        })),
        update,
      },
    } as unknown as PrismaClient;
    const intent = await ensureDispatchIntent(prisma, {
      practiceId: 'p1', claimId: 'c1', queueEntryId: 'q1', attemptNumber: 1,
    });
    expect(intent).toMatchObject({ status: 'READY', idempotencyKey: 'carrier-call:q1:1' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'i1', status: 'FAILED' },
    }));
  });
});
