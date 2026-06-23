import type { CarrierId, PrismaClient } from '@prisma/client';
import { sendCarrierBlockAlert } from '../../services/alerts.js';
import { endVapiCall } from '../../vapi/client.js';
import { broadcastDesk } from './deskWs.js';
import { mapCarrierBlock } from './deskMappers.js';
import { refreshDeskQueueBroadcast } from './deskQueueBroadcast.js';

export async function applyCarrierBlock(
  prisma: PrismaClient,
  params: {
    practiceId: string;
    carrierId: CarrierId;
    vapiCallId: string;
    reason: string;
    hangVapi?: boolean;
  },
): Promise<{ heldQueueCount: number }> {
  const { practiceId, carrierId, vapiCallId, reason, hangVapi = true } = params;

  if (hangVapi) {
    try {
      await endVapiCall(vapiCallId);
    } catch (err) {
      console.error('[carrierBlock] Vapi hang failed:', err);
    }
  }

  let heldQueueCount = 0;

  await prisma.$transaction(async (tx) => {
    await tx.carrierBlockEvent.create({
      data: {
        practiceId,
        carrierId,
        notes: reason,
      },
    });

    const held = await tx.callQueue.updateMany({
      where: {
        practiceId,
        status: 'PENDING',
        claim: { carrierId },
      },
      data: { status: 'BLOCKED' },
    });
    heldQueueCount = held.count;

    await tx.insuranceClaim.updateMany({
      where: { practiceId, carrierId, status: { in: ['PENDING', 'IN_QUEUE', 'CALLING'] } },
      data: { status: 'BLOCKED' },
    });

    await tx.callAttempt.updateMany({
      where: { vapiCallId, completedAt: null },
      data: { liveState: 'carrier_blocked', carrierBlockDetected: true },
    });
  });

  try {
    await sendCarrierBlockAlert({
      practiceId,
      carrierId,
      vapiCallId,
      outcomeDetail: reason,
    });
  } catch (err) {
    console.error('[carrierBlock] alert failed:', err);
  }

  const block = await prisma.carrierBlockEvent.findFirst({
    where: { practiceId, carrierId, resumedAt: null },
    orderBy: { blockedAt: 'desc' },
  });

  if (block) {
    broadcastDesk(practiceId, {
      type: 'carrier.blocked',
      data: { block: mapCarrierBlock(block, heldQueueCount), affectedQueueCount: heldQueueCount },
    });
  }

  await refreshDeskQueueBroadcast(prisma, practiceId);

  return { heldQueueCount };
}

export async function clearCarrierBlock(
  prisma: PrismaClient,
  practiceId: string,
  carrierId: CarrierId,
  staffId: string,
  notes?: string,
): Promise<boolean> {
  const updateResult = await prisma.carrierBlockEvent.updateMany({
    where: { practiceId, carrierId, resumedAt: null },
    data: { resumedAt: new Date(), resumedBy: staffId, notes: notes ?? null },
  });

  if (updateResult.count === 0) return false;

  await prisma.callQueue.updateMany({
    where: { practiceId, status: 'BLOCKED', claim: { carrierId } },
    data: { status: 'PENDING' },
  });

  await prisma.insuranceClaim.updateMany({
    where: { practiceId, carrierId, status: 'BLOCKED' },
    data: { status: 'IN_QUEUE' },
  });

  broadcastDesk(practiceId, { type: 'carrier.unblocked', data: { carrierId } });
  await refreshDeskQueueBroadcast(prisma, practiceId);
  return true;
}
