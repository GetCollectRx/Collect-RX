import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { getAdjudicationGraph } from '../../src/server/adjudication/adjudicationGraph.js';

describe('getAdjudicationGraph', () => {
  it('aggregates events by call type and carrier', async () => {
    const now = new Date();
    const prisma = {
      adjudicationEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            callType: 'pre_visit_cdcp',
            denialReasonCode: 'F-010',
            carrierId: 'sun_life',
            outcome: 'success',
            callDurationMs: 120_000,
            createdAt: now,
          },
          {
            callType: 'portal_check',
            denialReasonCode: null,
            carrierId: 'canada_life',
            outcome: 'failed',
            callDurationMs: null,
            createdAt: now,
          },
        ]),
      },
    } as unknown as PrismaClient;

    const graph = await getAdjudicationGraph(prisma, 'practice-1', 30);
    expect(graph.totalEvents).toBe(2);
    expect(graph.byCallType).toHaveLength(2);
    expect(graph.byCarrier.find((b) => b.key === 'sun_life')?.count).toBe(1);
  });
});
