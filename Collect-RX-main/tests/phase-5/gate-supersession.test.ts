import { describe, expect, it } from 'vitest';
import { shouldSupersedeBlockingGate } from '../../src/server/recovery/gateSupersession.js';
import type { RecoveryDecision } from '../../src/server/recovery/types.js';

function decision(partial: Partial<RecoveryDecision>): RecoveryDecision {
  return {
    route: 'PRACTICE_GATE',
    claimStatus: 'ON_HOLD',
    queueStatus: 'ESCALATED',
    scheduledRecallAt: null,
    recoveryActionType: null,
    actionTitle: null,
    actionDetail: null,
    paymentExpectedBy: null,
    openCdcpCase: false,
    stopCalling: true,
    reason: 'test',
    ...partial,
  };
}

describe('shouldSupersedeBlockingGate', () => {
  it('does not clear resubmit gate on no_answer follow-up', () => {
    const d = decision({ route: 'CALL_CARRIER', claimStatus: 'IN_QUEUE', stopCalling: false });
    expect(
      shouldSupersedeBlockingGate('PRACTICE_RESUBMIT', d, 'Carrier busy (legacy: no_answer)'),
    ).toBe(false);
  });

  it('clears resubmit gate when carrier confirms processing', () => {
    const d = decision({ route: 'CALL_CARRIER', claimStatus: 'IN_QUEUE', stopCalling: false });
    expect(
      shouldSupersedeBlockingGate('PRACTICE_RESUBMIT', d, 'In process (legacy: processing)'),
    ).toBe(true);
  });

  it('replaces blocking gate when new gate type arrives', () => {
    const d = decision({
      recoveryActionType: 'PRACTICE_DOCS',
      actionTitle: 'Attach radiographs',
    });
    expect(shouldSupersedeBlockingGate('PRACTICE_RESUBMIT', d, null)).toBe(true);
  });

  it('does not auto-clear CDCP reconsideration gate', () => {
    const d = decision({
      route: 'CALL_CARRIER',
      claimStatus: 'IN_QUEUE',
      recoveryActionType: null,
    });
    expect(shouldSupersedeBlockingGate('CDCP_RECONSIDERATION', d, '(legacy: processing)')).toBe(
      false,
    );
  });

  it('clears human escalation on verified resolve', () => {
    const d = decision({
      route: 'STOP',
      claimStatus: 'RESOLVED',
      stopCalling: true,
    });
    expect(shouldSupersedeBlockingGate('HUMAN_ESCALATION', d, '(legacy: paid)')).toBe(true);
  });
});
