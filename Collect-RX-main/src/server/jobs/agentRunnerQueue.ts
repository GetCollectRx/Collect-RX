import { Queue, type ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../observability/logger.js';

let sharedConnection: IORedis | null = null;
let agentRunnerQueue: Queue | null = null;

function getQueueConnection(): IORedis {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_URL is not set');
  }
  if (!sharedConnection) {
    sharedConnection = new IORedis(url, { maxRetriesPerRequest: null });
  }
  return sharedConnection;
}

export function getAgentRunnerQueue(): Queue {
  if (!agentRunnerQueue) {
    const connection = getQueueConnection();
    agentRunnerQueue = new Queue('agent-runner', { connection: connection as unknown as ConnectionOptions });
  }
  return agentRunnerQueue;
}

export interface AgentRunJob {
  agentName: string;
  cron: string;
  upstreamAgents: string[];
  timeWindow: string;
}

export async function closeAgentRunnerQueue(): Promise<void> {
  if (agentRunnerQueue) {
    try {
      await agentRunnerQueue.close();
      agentRunnerQueue = null;
      logger.debug('[agentRunnerQueue] Queue closed');
    } catch (err) {
      logger.error('[agentRunnerQueue] Error closing queue', { error: String(err) });
    }
  }
}
