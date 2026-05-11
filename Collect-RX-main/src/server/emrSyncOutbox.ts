import { Prisma, type PrismaClient } from '@prisma/client';
import { recordEmrOutbox } from './observability/metrics.js';

export async function enqueueEmrClaimEvent(
  prisma: PrismaClient,
  params: {
    practiceId: string;
    claimId: string;
    eventType: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await prisma.emrSyncOutbox.create({
    data: {
      practiceId: params.practiceId,
      claimId: params.claimId,
      eventType: params.eventType,
      payloadJson: params.payload as Prisma.InputJsonValue,
    },
  });
}

export interface EmrOutboxBatchResult {
  pulled: number;
  markedProcessed: number;
  deliveryFailed: number;
}

/**
 * Drain pending `emr_sync_outbox` rows (runs on each rules-engine tick — worker + in-process).
 *
 * - Set `EMR_SYNC_WEBHOOK_URL` to POST each row as JSON to your bridge (AbelDent, etc.). 2xx → mark processed.
 * - Or `EMR_OUTBOX_DEV_ACK=1` in local dev to mark rows processed without HTTP (avoids infinite backlog).
 * - If neither is set, rows stay pending and a one-line warning is logged when the queue is non-empty.
 */
export async function processEmrSyncOutboxBatch(prisma: PrismaClient): Promise<EmrOutboxBatchResult> {
  const rawBatch = parseInt(process.env.EMR_OUTBOX_BATCH_SIZE ?? '20', 10);
  const batchSize = Math.min(100, Math.max(1, Number.isFinite(rawBatch) ? rawBatch : 20));

  const webhookUrl = (process.env.EMR_SYNC_WEBHOOK_URL || '').trim();
  const webhookSecret = (process.env.EMR_SYNC_WEBHOOK_SECRET || '').trim();
  const devAck =
    process.env.EMR_OUTBOX_DEV_ACK === '1' || process.env.EMR_OUTBOX_DEV_ACK === 'true';

  const rows = await prisma.emrSyncOutbox.findMany({
    where: { processedAt: null },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
  });

  if (rows.length === 0) {
    return { pulled: 0, markedProcessed: 0, deliveryFailed: 0 };
  }

  if (!webhookUrl && !devAck) {
    console.warn(
      `[emrOutbox] ${rows.length}+ pending row(s) — set EMR_SYNC_WEBHOOK_URL (production) or EMR_OUTBOX_DEV_ACK=1 (local)`,
    );
    return { pulled: rows.length, markedProcessed: 0, deliveryFailed: 0 };
  }

  let markedProcessed = 0;
  let deliveryFailed = 0;

  for (const row of rows) {
    try {
      if (devAck && !webhookUrl) {
        await prisma.emrSyncOutbox.update({
          where: { id: row.id },
          data: { processedAt: new Date() },
        });
        markedProcessed += 1;
        recordEmrOutbox('dev_ack');
        console.log(
          `[emrOutbox] dev_ack id=${row.id} event=${row.eventType} claimId=${row.claimId}`,
        );
        continue;
      }

      const body = JSON.stringify({
        schemaVersion: 1,
        id: row.id,
        practiceId: row.practiceId,
        claimId: row.claimId,
        eventType: row.eventType,
        payload: row.payloadJson,
        createdAt: row.createdAt.toISOString(),
      });

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-CollectRx-Event': row.eventType,
      };
      if (webhookSecret) {
        headers.Authorization = `Bearer ${webhookSecret}`;
      }

      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(15_000),
      });

      if (res.ok) {
        await prisma.emrSyncOutbox.update({
          where: { id: row.id },
          data: { processedAt: new Date() },
        });
        markedProcessed += 1;
        recordEmrOutbox('delivered');
      } else {
        deliveryFailed += 1;
        recordEmrOutbox('failed');
        const snippet = (await res.text()).slice(0, 200);
        console.error(
          `[emrOutbox] webhook ${res.status} for id=${row.id}: ${snippet || res.statusText}`,
        );
      }
    } catch (err) {
      deliveryFailed += 1;
      recordEmrOutbox('failed');
      console.error(`[emrOutbox] delivery error id=${row.id}:`, (err as Error).message);
    }
  }

  return { pulled: rows.length, markedProcessed, deliveryFailed };
}
