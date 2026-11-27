import { describe, it, expect, vi, beforeEach } from 'vitest';

const info = vi.fn();
vi.mock('../src/server/observability/logger.js', () => ({
  logger: { info: (...a: unknown[]) => info(...a), error: vi.fn(), warn: vi.fn() },
}));
const createEscalation = vi.fn().mockResolvedValue({});
vi.mock('../src/server/services/escalationService.js', () => ({
  createEscalation: (...a: unknown[]) => createEscalation(...a),
}));

import { emitHandoffEvent, openAutomationSuspicionReview } from '../src/server/frontDesk/handoffEvents';

beforeEach(() => { info.mockClear(); createEscalation.mockClear(); });

describe('handoff events', () => {
  it('logs ids only', () => {
    emitHandoffEvent('handoff_attempted', { vapiCallId: 'v1' });
    expect(info).toHaveBeenCalledWith('[handoff-event] handoff_attempted', { event: 'handoff_attempted', vapiCallId: 'v1' });
  });
  it('suspicion opens an escalation and logs, without suspending the carrier', async () => {
    await openAutomationSuspicionReview({} as never, {
      practiceId: 'p', claimId: 'c', claimRef: 'CL-1', carrierId: 'SUN_LIFE' as never, amountClaimedCents: 1000,
    });
    expect(createEscalation).toHaveBeenCalledTimes(1);
    expect(createEscalation.mock.calls[0][1].reason).toMatch(/suspected an automated caller/);
    expect(info.mock.calls[0][0]).toContain('automation_suspicion_flagged');
  });
  it('escalation failure is non-fatal', async () => {
    createEscalation.mockRejectedValueOnce(new Error('db'));
    await expect(openAutomationSuspicionReview({} as never, {
      practiceId: 'p', claimId: 'c', claimRef: 'x', carrierId: 'SUN_LIFE' as never, amountClaimedCents: 0,
    })).resolves.toBeUndefined();
  });
});
