/**
 * P8 — BullMQ queue for A/R background work (shared name between API and worker).
 */
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const AR_QUEUE_NAME = 'collectrx-ar';

let sharedConnection: IORedis | null = null;
let arQueue: Queue | null = null;

export function getQueueConnection(): IORedis {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_URL is not set');
  }
  if (!sharedConnection) {
    sharedConnection = new IORedis(url, { maxRetriesPerRequest: null });
  }
  return sharedConnection;
}

export function getArQueue(): Queue {
  if (!arQueue) {
    arQueue = new Queue(AR_QUEUE_NAME, { connection: getQueueConnection() });
  }
  return arQueue;
}

/** P8-03: surface queue depth for alerts / dashboards. */
export async function getQueueJobCounts() {
  const q = getArQueue();
  const c = await q.getJobCounts();
  return { queue: AR_QUEUE_NAME, ...c };
}
