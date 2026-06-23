import { describe, expect, it } from 'vitest';
import { shouldSupersedeOpenAction } from '../../src/server/recovery/gateSupersession.js';
import type { RecoveryDecision } from '../../src/server/recovery/types.js';

function decision(partial: Partial<RecoveryDecision>): RecoveryDecision {
  return {
    route: 'CALL_CARRIER',
    claimStatus: 'IN_QUEUE',
    queueStatus: 'PENDING',
    scheduledRecallAt: new Date(),
    recoveryActionType: null,
    actionTitle: null,
    actionDetail: null,
    paymentExpectedBy: null,
    openCdcpCase: false,
    stopCalling: false,
    reason: 'test',
    ...partial,
  };
}

describe('shouldSupersedeOpenAction', () => {
  it('does not clear PAYMENT_VERIFY_SYNC on no_answer retry', () => {
    const d = decision({ route: 'CALL_CARRIER', recoveryActionType: null });
    expect(shouldSupersedeOpenAction('PAYMENT_VERIFY_SYNC', d)).toBe(false);
  });

  it('clears PAYMENT_VERIFY_SYNC when sync closes the loop', () => {
    const d = decision({ route: 'STOP', claimStatus: 'RESOLVED', stopCalling: true });
    expect(shouldSupersedeOpenAction('PAYMENT_VERIFY_SYNC', d)).toBe(true);
  });

  it('replaces PROCESSING_RECALL when a new processing recall is scheduled', () => {
    const d = decision({ recoveryActionType: 'PROCESSING_RECALL', actionTitle: 'Follow-up' });
    expect(shouldSupersedeOpenAction('PROCESSING_RECALL', d)).toBe(true);
  });
});
