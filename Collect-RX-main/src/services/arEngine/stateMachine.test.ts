import { describe, expect, it } from 'vitest';
import {
  computeNextState,
  isTerminalState,
  InvalidTransitionError,
  CarrierBlockedError,
  CallLifecycleMachine,
  InMemoryCallLifecycleStore,
  detectStalledAttempts,
  computeHoldSecondsFromHistory,
  toLiveCallState,
  DEFAULT_STALL_THRESHOLD_MS,
  type CallLifecycleAttemptRecord,
  type CallLifecycleTransitionRecord,
} from './stateMachine.js';

describe('computeNextState', () => {
  it('allows a valid forward transition', () => {
    expect(computeNextState('Claim_Queued', 'Dialing')).toBe('Dialing');
  });

  it('is idempotent for a repeated identical state request', () => {
    expect(computeNextState('Dialing', 'Dialing')).toBe('Dialing');
  });

  it('rejects an illegal transition', () => {
    expect(() => computeNextState('Claim_Queued', 'Agent_Connected')).toThrow(InvalidTransitionError);
  });

  it('allows the durable retry edge from Failed back to Claim_Queued', () => {
    expect(computeNextState('Failed', 'Claim_Queued')).toBe('Claim_Queued');
  });

  it('marks Success and Failed as terminal', () => {
    expect(isTerminalState('Success')).toBe(true);
    expect(isTerminalState('Failed')).toBe(true);
    expect(isTerminalState('Dialing')).toBe(false);
  });
});

describe('CallLifecycleMachine', () => {
  it('drives a full happy-path sequence to Success', async () => {
    const store = new InMemoryCallLifecycleStore();
    const machine = new CallLifecycleMachine(store, () => false);

    await machine.start('attempt-1', 'claim-1', 'sun_life');
    await machine.transition('attempt-1', 'Dialing');
    await machine.transition('attempt-1', 'IVR_Navigation');
    await machine.transition('attempt-1', 'Agent_Connected');
    await machine.transition('attempt-1', 'Adjudication_Extracting');
    await machine.transition('attempt-1', 'Sync_Pending');
    const final = await machine.transition('attempt-1', 'Success');

    expect(final.currentState).toBe('Success');
    expect(final.history).toHaveLength(6);
  });

  it('refuses to enter a dial-capable state when CARRIER_BLOCK is active', async () => {
    const store = new InMemoryCallLifecycleStore();
    const machine = new CallLifecycleMachine(store, () => true);

    await machine.start('attempt-2', 'claim-2', 'manulife');
    await expect(machine.transition('attempt-2', 'Dialing')).rejects.toThrow(CarrierBlockedError);
  });

  it('does not gate non-dialing states on CARRIER_BLOCK', async () => {
    const store = new InMemoryCallLifecycleStore();
    let checked = 0;
    const machine = new CallLifecycleMachine(store, () => {
      checked += 1;
      return false;
    });

    await machine.start('attempt-3', 'claim-3', 'green_shield');
    await machine.transition('attempt-3', 'Dialing');
    checked = 0;
    await machine.transition('attempt-3', 'IVR_Navigation');
    await machine.transition('attempt-3', 'Agent_Connected');
    // Only Dialing/IVR_Navigation are gated — Agent_Connected should not re-check.
    expect(checked).toBe(1);
  });

  it('replays the same idempotency key as a no-op', async () => {
    const store = new InMemoryCallLifecycleStore();
    const machine = new CallLifecycleMachine(store, () => false);

    await machine.start('attempt-4', 'claim-4', 'rbc');
    await machine.transition('attempt-4', 'Dialing', { idempotencyKey: 'webhook-1' });
    const replayed = await machine.transition('attempt-4', 'Dialing', { idempotencyKey: 'webhook-1' });

    expect(replayed.currentState).toBe('Dialing');
    expect(replayed.history).toHaveLength(1);
  });

  it('resumes a dropped call via the Failed -> Claim_Queued retry edge', async () => {
    const store = new InMemoryCallLifecycleStore();
    const machine = new CallLifecycleMachine(store, () => false);

    await machine.start('attempt-5', 'claim-5', 'telus_adjudicare');
    await machine.transition('attempt-5', 'Dialing');
    await machine.transition('attempt-5', 'IVR_Navigation');
    await machine.transition('attempt-5', 'Failed');
    const resumed = await machine.transition('attempt-5', 'Claim_Queued');

    expect(resumed.currentState).toBe('Claim_Queued');
  });
});

function record(overrides: Partial<CallLifecycleAttemptRecord>): CallLifecycleAttemptRecord {
  return {
    attemptId: 'a',
    claimId: 'c',
    carrierId: 'sun_life',
    currentState: 'IVR_Navigation',
    updatedAt: new Date(),
    history: [],
    ...overrides,
  };
}

describe('detectStalledAttempts', () => {
  it('flags a non-terminal attempt past the stall threshold', () => {
    const now = new Date('2026-08-05T12:00:00Z');
    const stuckSince = new Date(now.getTime() - DEFAULT_STALL_THRESHOLD_MS - 60_000);
    const stalled = detectStalledAttempts(
      [record({ attemptId: 'stuck', updatedAt: stuckSince })],
      new Map(),
      now,
    );
    expect(stalled).toHaveLength(1);
    expect(stalled[0].attemptId).toBe('stuck');
    expect(stalled[0].recommendedAction).toBe('RETRY');
  });

  it('recommends human escalation once max attempts are exhausted', () => {
    const now = new Date('2026-08-05T12:00:00Z');
    const stuckSince = new Date(now.getTime() - DEFAULT_STALL_THRESHOLD_MS - 60_000);
    const stalled = detectStalledAttempts(
      [record({ attemptId: 'stuck', claimId: 'claim-x', updatedAt: stuckSince })],
      new Map([['claim-x', 3]]),
      now,
    );
    expect(stalled[0].recommendedAction).toBe('HUMAN_ESCALATION');
  });

  it('ignores terminal states and fresh attempts', () => {
    const now = new Date('2026-08-05T12:00:00Z');
    const stalled = detectStalledAttempts(
      [
        record({ attemptId: 'done', currentState: 'Success', updatedAt: new Date(0) }),
        record({ attemptId: 'fresh', updatedAt: now }),
      ],
      new Map(),
      now,
    );
    expect(stalled).toHaveLength(0);
  });
});

describe('computeHoldSecondsFromHistory', () => {
  function transition(
    fromState: CallLifecycleTransitionRecord['fromState'],
    toState: CallLifecycleTransitionRecord['toState'],
    occurredAt: string,
  ): CallLifecycleTransitionRecord {
    return { attemptId: 'a', fromState, toState, occurredAt: new Date(occurredAt), idempotencyKey: null };
  }

  it('returns null when the attempt never held', () => {
    const history = [transition('Claim_Queued', 'Dialing', '2026-08-05T12:00:00Z')];
    expect(computeHoldSecondsFromHistory(history)).toBeNull();
  });

  it('sums the wall-clock time spent in Queue_Hold', () => {
    const history = [
      transition('Dialing', 'IVR_Navigation', '2026-08-05T12:00:00Z'),
      transition('IVR_Navigation', 'Queue_Hold', '2026-08-05T12:00:10Z'),
      transition('Queue_Hold', 'Agent_Connected', '2026-08-05T12:03:10Z'),
    ];
    expect(computeHoldSecondsFromHistory(history)).toBe(180);
  });
});

describe('toLiveCallState', () => {
  it('projects every lifecycle state onto a known desk-live value', () => {
    expect(toLiveCallState('Claim_Queued')).toBe('queued');
    expect(toLiveCallState('Agent_Connected')).toBe('rep_connected');
    expect(toLiveCallState('Adjudication_Extracting')).toBe('resolving');
    expect(toLiveCallState('Success')).toBe('completed');
    expect(toLiveCallState('Failed')).toBe('failed');
  });
});
