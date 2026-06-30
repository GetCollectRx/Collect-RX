import { Prisma, type PrismaClient } from '@prisma/client';
import { recordEmrOutbox } from './observability/metrics.js';
import { assertEmrSyncWebhookUrlAllowed } from './emrWebhookUrl.js';

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

/** Shadow-ledger sync for pre-visit verification outcomes (no claim row required). */
export async function enqueueEmrPreVisitEvent(
  prisma: PrismaClient,
  params: {
    practiceId: string;
    appointmentVerificationId: string;
    eventType: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await prisma.emrSyncOutbox.create({
    data: {
      practiceId: params.practiceId,
      claimId: `pre-visit:${params.appointmentVerificationId}`,
      eventType: params.eventType,
      payloadJson: {
        ...params.payload,
        appointmentVerificationId: params.appointmentVerificationId,
      } as Prisma.InputJsonValue,
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

  // C-4: plain findMany allows concurrent ticks to pull the same rows and
  // deliver each EMR event twice. Use FOR UPDATE SKIP LOCKED inside an
  // explicit transaction to atomically select AND claim rows before delivery.
  // The claim (processedAt = now) is written inside the same transaction so
  // no other tick can pick the same rows. On delivery failure, processedAt is
  // reset to null so the row is retried on the next tick.
  const rows = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM emr_sync_outbox
      WHERE processed_at IS NULL
      ORDER BY created_at ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `;
    if (locked.length === 0) return [];
    return tx.emrSyncOutbox.findMany({
      where: { id: { in: locked.map((r) => r.id) } },
      orderBy: { createdAt: 'asc' },
    });
  });

  if (rows.length === 0) {
    return { pulled: 0, markedProcessed: 0, deliveryFailed: 0 };
  }

  if (webhookUrl) {
    try {
      assertEmrSyncWebhookUrlAllowed(webhookUrl);
    } catch (e) {
      console.error('[emrOutbox] invalid EMR_SYNC_WEBHOOK_URL — skipping batch:', (e as Error).message);
      return { pulled: rows.length, markedProcessed: 0, deliveryFailed: rows.length };
    }
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
        // Delivery failed — reset processedAt so the row is retried next tick.
        await prisma.emrSyncOutbox.update({
          where: { id: row.id },
          data: { processedAt: null },
        }).catch(() => {});
        deliveryFailed += 1;
        recordEmrOutbox('failed');
        const snippet = (await res.text()).slice(0, 200);
        console.error(
          `[emrOutbox] webhook ${res.status} for id=${row.id}: ${snippet || res.statusText}`,
        );
      }
    } catch (err) {
      // Network/timeout error — reset for retry next tick.
      await prisma.emrSyncOutbox.update({
        where: { id: row.id },
        data: { processedAt: null },
      }).catch(() => {});
      deliveryFailed += 1;
      recordEmrOutbox('failed');
      console.error(`[emrOutbox] delivery error id=${row.id}:`, (err as Error).message);
    }
  }

  return { pulled: rows.length, markedProcessed, deliveryFailed };
}
