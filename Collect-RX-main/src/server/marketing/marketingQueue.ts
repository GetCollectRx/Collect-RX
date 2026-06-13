/**
 * Marketing BullMQ queue for outbound partnership prospecting workflows.
 * Runs independently of the AR queue.
 */
import { Queue } from 'bullmq';
import { getQueueConnection } from '../jobs/arQueue.js';

export const MARKETING_QUEUE_NAME = 'collectrx-marketing';

let marketingQueue: Queue | null = null;

export function getMarketingQueue(): Queue {
  if (!marketingQueue) {
    marketingQueue = new Queue(MARKETING_QUEUE_NAME, { connection: getQueueConnection() });
  }
  return marketingQueue;
}

export async function getMarketingQueueCounts() {
  const q = getMarketingQueue();
  const c = await q.getJobCounts();
  return { queue: MARKETING_QUEUE_NAME, ...c };
}
