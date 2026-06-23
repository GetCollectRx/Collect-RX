import type { PrismaClient } from '@prisma/client';
import { broadcastDesk } from './deskWs.js';
import { mapQueueEntry } from './deskMappers.js';

export async function refreshDeskQueueBroadcast(
  prisma: PrismaClient,
  practiceId: string,
): Promise<void> {
  const rows = await prisma.callQueue.findMany({
    where: { practiceId, status: { in: ['PENDING', 'BLOCKED'] } },
    orderBy: [{ priority: 'desc' }, { scheduledFor: 'asc' }],
    include: {
      claim: {
        select: { claimNumber: true, carrierId: true, outstandingAmount: true },
      },
    },
  });

  broadcastDesk(practiceId, {
    type: 'queue.updated',
    data: { queue: rows.map(mapQueueEntry) },
  });
}
