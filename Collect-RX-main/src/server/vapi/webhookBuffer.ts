/**
 * Vapi Webhook Buffer — Handle race condition when webhooks arrive before CallAttempt creation.
 *
 * Race condition: webhook arrives between initiateCall() and callAttempt.create().
 * - initiateCall() succeeds → vapiCallId
 * - Webhook arrives immediately (rare, but possible with fast calls)
 * - callAttempt.create() hasn't happened yet
 * - Webhook handler finds no CallAttempt and drops the webhook
 * - Claim stuck in wrong state forever
 *
 * Solution: Buffer early webhooks and retry when CallAttempt is eventually created.
 * Buffered entries time out after 30 seconds (longer than longest possible dispatch delay).
 */

import type { VapiWebhookPayloadValidated } from '../../vapi/webhookValidator';

interface BufferedWebhook {
  vapiCallId: string;
  payload: VapiWebhookPayloadValidated;
  arrivedAt: Date;
}

const BUFFER_TTL_MS = 30_000; // 30 seconds
const bufferMap = new Map<string, BufferedWebhook>();

/**
 * Store a webhook that arrived before its CallAttempt was created.
 */
export function bufferEarlyWebhook(payload: VapiWebhookPayloadValidated): void {
  const vapiCallId = payload.call.id;
  bufferMap.set(vapiCallId, {
    vapiCallId,
    payload,
    arrivedAt: new Date(),
  });

  // Auto-expire after TTL
  setTimeout(() => {
    const buffered = bufferMap.get(vapiCallId);
    if (buffered && Date.now() - buffered.arrivedAt.getTime() >= BUFFER_TTL_MS) {
      console.warn(
        `[webhookBuffer] Buffered webhook expired (no CallAttempt created within 30s): vapiCallId=${vapiCallId}`,
      );
      bufferMap.delete(vapiCallId);
    }
  }, BUFFER_TTL_MS);
}

/**
 * Retrieve buffered webhook if one exists for this call.
 * Removes it from buffer (one-time use).
 */
export function retrieveBufferedWebhook(vapiCallId: string): VapiWebhookPayloadValidated | null {
  const buffered = bufferMap.get(vapiCallId);
  if (buffered) {
    bufferMap.delete(vapiCallId);
    console.log(
      `[webhookBuffer] Retrieved buffered webhook after ${Date.now() - buffered.arrivedAt.getTime()}ms: vapiCallId=${vapiCallId}`,
    );
    return buffered.payload;
  }
  return null;
}

/**
 * Reprocess a buffered webhook after CallAttempt is created.
 * Used when a webhook arrives early and we now have the CallAttempt record.
 */
export async function reprocessBufferedWebhook(
  _prisma: unknown,
  vapiCallId: string,
  processWebhookFn: (payload: VapiWebhookPayloadValidated, rawBody?: unknown) => Promise<void>,
): Promise<boolean> {
  const buffered = bufferMap.get(vapiCallId);
  if (!buffered) {
    return false;
  }

  try {
    console.log(
      `[webhookBuffer] Reprocessing buffered webhook: vapiCallId=${vapiCallId} (${Date.now() - buffered.arrivedAt.getTime()}ms old)`,
    );
    await processWebhookFn(buffered.payload);
    bufferMap.delete(vapiCallId);
    return true;
  } catch (err) {
    console.error(`[webhookBuffer] Reprocessing failed for vapiCallId=${vapiCallId}:`, err);
    // Leave in buffer for retry
    return false;
  }
}

/**
 * Clear the buffer (for testing or administrative purposes).
 */
export function clearBuffer(): void {
  bufferMap.clear();
}

/**
 * Get current buffer size (for diagnostics).
 */
export function getBufferStats(): { size: number; entries: string[] } {
  return {
    size: bufferMap.size,
    entries: Array.from(bufferMap.keys()),
  };
}
