import { describe, expect, it } from 'vitest';
import { CLAIM_ROUTER_DECISION_TABLE, routeClaimRecovery } from '../../src/server/recovery/claimRouter.js';

const base = {
  outstandingCents: 50_000,
  carrierId: 'manulife',
  daysOutstanding: 45,
  attemptCount: 1,
  hasBlockingPracticeGate: false,
  hasOpenCdcpCase: false,
  paymentCorroborated: false,
  outcomeDetail: null,
  gatedClaimStatus: 'IN_QUEUE' as const,
  proposedClaimStatus: 'IN_QUEUE' as const,
};

describe('routeClaimRecovery', () => {
  it('schedules 72h re-call for processing outcomes', () => {
    const d = routeClaimRecovery({
      ...base,
      callOutcome: 'PENDING',
      outcomeDetail: 'Claim still processing (legacy: processing)',
      gatedClaimStatus: 'IN_QUEUE',
      proposedClaimStatus: 'IN_QUEUE',
    });
    expect(d.route).toBe('CALL_CARRIER');
    expect(d.queueStatus).toBe('PENDING');
    expect(d.recoveryActionType).toBe('PROCESSING_RECALL');
    expect(d.scheduledRecallAt).not.toBeNull();
    const hours = (d.scheduledRecallAt!.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(71);
    expect(hours).toBeLessThan(73);
  });

  it('blocks re-call for resubmit_required with practice gate', () => {
    const d = routeClaimRecovery({
      ...base,
      callOutcome: 'ESCALATED',
      outcomeDetail: 'Claim not on file (legacy: resubmit_required)',
      gatedClaimStatus: 'ESCALATED',
      proposedClaimStatus: 'ESCALATED',
    });
    expect(d.route).toBe('PRACTICE_GATE');
    expect(d.claimStatus).toBe('ON_HOLD');
    expect(d.recoveryActionType).toBe('PRACTICE_RESUBMIT');
    expect(d.stopCalling).toBe(true);
  });

  it('opens CDCP path for Sun Life denial', () => {
    const d = routeClaimRecovery({
      ...base,
      carrierId: 'sun_life',
      callOutcome: 'DENIED',
      outcomeDetail: 'CDCP claim denied — not covered (legacy: not_covered)',
      gatedClaimStatus: 'DENIED',
      proposedClaimStatus: 'DENIED',
    });
    expect(d.route).toBe('OPEN_CDCP');
    expect(d.openCdcpCase).toBe(true);
    expect(d.stopCalling).toBe(true);
  });

  it('waits for sync when payment corroborated', () => {
    const d = routeClaimRecovery({
      ...base,
      callOutcome: 'RESOLVED',
      outcomeDetail: 'Payment issued ref SL12345',
      gatedClaimStatus: 'RESOLVED',
      proposedClaimStatus: 'RESOLVED',
      paymentCorroborated: true,
    });
    expect(d.route).toBe('WAIT_SYNC');
    expect(d.recoveryActionType).toBe('PAYMENT_VERIFY_SYNC');
    expect(d.stopCalling).toBe(true);
    expect(d.paymentExpectedBy).not.toBeNull();
  });

  it('escalates unconfirmed financial outcomes', () => {
    const d = routeClaimRecovery({
      ...base,
      callOutcome: 'RESOLVED',
      outcomeDetail: 'Claim resolved',
      gatedClaimStatus: 'ESCALATED',
      proposedClaimStatus: 'RESOLVED',
      paymentCorroborated: false,
    });
    expect(d.route).toBe('PRACTICE_GATE');
    expect(d.recoveryActionType).toBe('HUMAN_ESCALATION');
  });

  it('holds uncleared practice gate on no_answer follow-up', () => {
    const d = routeClaimRecovery({
      ...base,
      hasBlockingPracticeGate: true,
      callOutcome: 'NO_ANSWER',
      outcomeDetail: 'Busy (legacy: no_answer)',
      gatedClaimStatus: 'IN_QUEUE',
      proposedClaimStatus: 'IN_QUEUE',
    });
    expect(d.route).toBe('PRACTICE_GATE');
    expect(d.claimStatus).toBe('ON_HOLD');
    expect(d.recoveryActionType).toBeNull();
    expect(d.stopCalling).toBe(true);
  });

  it('allows processing outcome to supersede open resubmit gate', () => {
    const d = routeClaimRecovery({
      ...base,
      hasBlockingPracticeGate: true,
      callOutcome: 'PENDING',
      outcomeDetail: 'In process (legacy: processing)',
      gatedClaimStatus: 'IN_QUEUE',
      proposedClaimStatus: 'IN_QUEUE',
    });
    expect(d.route).toBe('CALL_CARRIER');
    expect(d.recoveryActionType).toBe('PROCESSING_RECALL');
  });

  it('publishes a non-empty decision table', () => {
    expect(CLAIM_ROUTER_DECISION_TABLE.length).toBeGreaterThan(8);
    expect(CLAIM_ROUTER_DECISION_TABLE.some((r) => r.route === 'WAIT_SYNC')).toBe(true);
    expect(CLAIM_ROUTER_DECISION_TABLE.some((r) => r.route === 'OPEN_CDCP')).toBe(true);
  });
});
