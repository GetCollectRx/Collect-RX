import { describe, it, expect, vi } from 'vitest';
import type { HumanAssistedCallLog, PrismaClient } from '@prisma/client';
import { reconcileLateHandoffLog } from '../src/outcome/lateLogReconciliation';
import { NO_LOG_OUTCOME_DETAIL } from '../src/outcome/humanAssistedOutcomeResolver';

const log = { vapiCallId: 'v1', scenario: 'CLAIM_PAID', callSummary: 'Paid.', repName: 'Sam', referenceNumber: 'R1',
  matchesExpectedAmount: true, automationSuspicionFlag: false, unresolvedFields: null } as unknown as HumanAssistedCallLog;

function prismaWith(attempt: Record<string, unknown> | null) {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  return { p: { callAttempt: { findFirst: async () => attempt, updateMany } } as unknown as PrismaClient, updateMany };
}

describe('reconcileLateHandoffLog', () => {
  it('fills a no-log attempt from a late log', async () => {
    const { p, updateMany } = prismaWith({ id: 'a', completedAt: new Date(), outcomeDetail: NO_LOG_OUTCOME_DETAIL, transcriptUrl: null, durationSeconds: 5 });
    expect(await reconcileLateHandoffLog(p, log)).toBe(true);
    expect(updateMany.mock.calls[0][0].data).toMatchObject({ outcome: 'RESOLVED', repName: 'Sam', referenceNumber: 'R1' });
  });
  it('does nothing when the attempt was not closed without a log', async () => {
    const { p, updateMany } = prismaWith({ id: 'a', completedAt: new Date(), outcomeDetail: 'other', transcriptUrl: null, durationSeconds: 5 });
    expect(await reconcileLateHandoffLog(p, log)).toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
  });
  it('does nothing when the attempt is still open', async () => {
    const { p } = prismaWith({ id: 'a', completedAt: null, outcomeDetail: NO_LOG_OUTCOME_DETAIL });
    expect(await reconcileLateHandoffLog(p, log)).toBe(false);
  });
});
