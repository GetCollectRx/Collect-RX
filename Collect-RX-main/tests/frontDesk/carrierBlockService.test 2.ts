import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const endVapiCallMock = vi.fn();

vi.mock('../../src/vapi/client.js', () => ({
  endVapiCall: (...args: unknown[]) => endVapiCallMock(...args),
}));
vi.mock('../../src/services/alerts.js', () => ({
  sendCarrierBlockAlert: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/server/frontDesk/deskWs.js', () => ({
  broadcastDesk: vi.fn(),
}));
vi.mock('../../src/server/frontDesk/deskMappers.js', () => ({
  mapCarrierBlock: vi.fn((block: unknown) => block),
}));
vi.mock('../../src/server/frontDesk/deskQueueBroadcast.js', () => ({
  refreshDeskQueueBroadcast: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/server/discovery/carrierDiscoveryService.js', () => ({
  isCarrierDiscoveryEnabled: () => false,
  requestCarrierRediscovery: vi.fn(),
}));

import { applyCarrierBlock } from '../../src/server/frontDesk/carrierBlockService.js';

function createPrisma() {
  const prisma = {
    carrierBlockEvent: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue({
        id: 'block-1',
        practiceId: 'practice-1',
        carrierId: 'sun_life',
        blockedAt: new Date(),
      }),
    },
    callAttempt: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'attempt-1', vapiCallId: 'vapi-1' },
        { id: 'attempt-2', vapiCallId: 'vapi-2' },
      ]),
      updateMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
    callQueue: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
    insuranceClaim: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => Promise<void>) => callback(prisma));
  return prisma;
}

describe('applyCarrierBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    endVapiCallMock.mockResolvedValue(undefined);
  });

  it('blocks in-progress queue work and terminates every open call for the practice/carrier', async () => {
    const prisma = createPrisma();

    await applyCarrierBlock(prisma as unknown as PrismaClient, {
      practiceId: 'practice-1',
      carrierId: 'sun_life',
      vapiCallId: 'vapi-1',
      reason: 'carrier rejected automation',
    });

    expect(prisma.callQueue.updateMany).toHaveBeenCalledWith({
      where: {
        practiceId: 'practice-1',
        status: { in: ['PENDING', 'IN_PROGRESS'] },
        claim: { carrierId: 'sun_life' },
      },
      data: { status: 'BLOCKED' },
    });
    expect(prisma.callAttempt.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['attempt-1', 'attempt-2'] }, completedAt: null },
      data: expect.objectContaining({
        outcome: 'BLOCK_DETECTED',
        liveState: 'carrier_blocked',
        carrierBlockDetected: true,
        completedAt: expect.any(Date),
      }),
    });
    expect(endVapiCallMock).toHaveBeenCalledTimes(2);
    expect(endVapiCallMock).toHaveBeenCalledWith('vapi-1');
    expect(endVapiCallMock).toHaveBeenCalledWith('vapi-2');
  });

  it('terminates other open carrier calls when the triggering call already ended', async () => {
    const prisma = createPrisma();

    await applyCarrierBlock(prisma as unknown as PrismaClient, {
      practiceId: 'practice-1',
      carrierId: 'sun_life',
      vapiCallId: 'vapi-1',
      reason: 'carrier rejected automation',
      hangVapi: false,
    });

    expect(endVapiCallMock).toHaveBeenCalledTimes(1);
    expect(endVapiCallMock).toHaveBeenCalledWith('vapi-2');
  });
});
