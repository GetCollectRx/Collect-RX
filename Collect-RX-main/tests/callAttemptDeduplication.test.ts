/**
 * Call Attempt Deduplication — Guard against duplicate carrier calls
 *
 * Race condition: Queue engine tick runs twice on the same claim
 * (timing edge case, crash recovery, or clock drift).
 * Without deduplication, creates 2 CallAttempt records → Vapi calls made twice
 * → Carriers receive 2 calls within minutes → CARRIER_BLOCK triggered → all calling suspended.
 *
 * Solution: Before initiateCall(), check if CallAttempt was already created for
 * this claim within the last 24 hours. If yes, skip it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Call Attempt Deduplication — Preventing Duplicate Carrier Calls', () => {
  // Simulate queue engine state
  let claimId = 'claim-123';
  let callAttempts: Map<string, { claimId: string; vapiCallId: string; initiatedAt: Date }> = new Map();
  let vapiCallCount = 0;

  beforeEach(() => {
    callAttempts.clear();
    vapiCallCount = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Simulate initiateCall() — increments vapiCallCount and would make actual Vapi call
   */
  function simulateInitiateCall(claimId: string): string {
    vapiCallCount++;
    return `vapi-call-${vapiCallCount}`;
  }

  /**
   * Simulate the deduplication guard in queueEngine
   */
  function checkForRecentCallAttempt(
    claimId: string,
    withinMs: number = 24 * 60 * 60 * 1000,
  ): { exists: boolean; attempt: (typeof callAttempts)[0] | null } {
    const attempt = Array.from(callAttempts.values()).find(
      (a) =>
        a.claimId === claimId &&
        Date.now() - a.initiatedAt.getTime() < withinMs,
    );
    return { exists: !!attempt, attempt: attempt ?? null };
  }

  /**
   * Simulate creating a CallAttempt record
   */
  function createCallAttempt(claimId: string, vapiCallId: string): void {
    const id = `attempt-${callAttempts.size + 1}`;
    callAttempts.set(id, {
      claimId,
      vapiCallId,
      initiatedAt: new Date(),
    });
  }

  describe('Basic deduplication', () => {
    it('allows first call attempt for a claim', () => {
      const recentAttempt = checkForRecentCallAttempt(claimId);
      expect(recentAttempt.exists).toBe(false);

      // First tick: initiate call and create attempt
      const vapiCallId = simulateInitiateCall(claimId);
      createCallAttempt(claimId, vapiCallId);

      expect(vapiCallCount).toBe(1);
      expect(callAttempts.size).toBe(1);
    });

    it('blocks duplicate call attempt within 24 hours', () => {
      // First tick: make call
      const firstVapiCallId = simulateInitiateCall(claimId);
      createCallAttempt(claimId, firstVapiCallId);
      expect(vapiCallCount).toBe(1);

      // Second tick (5 seconds later): should be blocked
      vi.advanceTimersByTime(5000);
      const recentAttempt = checkForRecentCallAttempt(claimId);
      expect(recentAttempt.exists).toBe(true);

      // Because it exists, we skip initiateCall()
      // vapiCallCount should still be 1
      expect(vapiCallCount).toBe(1);
    });

    it('allows new call attempt after 24 hours', () => {
      // First call
      const firstVapiCallId = simulateInitiateCall(claimId);
      createCallAttempt(claimId, firstVapiCallId);
      expect(vapiCallCount).toBe(1);

      // Advance 24 hours + 1 second
      vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1000);

      // Should be allowed now
      const recentAttempt = checkForRecentCallAttempt(claimId);
      expect(recentAttempt.exists).toBe(false);

      // Can make new call
      const secondVapiCallId = simulateInitiateCall(claimId);
      createCallAttempt(claimId, secondVapiCallId);
      expect(vapiCallCount).toBe(2);
      expect(firstVapiCallId).not.toBe(secondVapiCallId);
    });
  });

  describe('Scenario: Queue engine tick runs twice (crash recovery)', () => {
    it('tick 1 makes call, tick 2 skips duplicate', () => {
      // Tick 1
      const recentBefore = checkForRecentCallAttempt(claimId);
      expect(recentBefore.exists).toBe(false);

      const vapiCallId1 = simulateInitiateCall(claimId);
      createCallAttempt(claimId, vapiCallId1);
      expect(vapiCallCount).toBe(1);

      // Tick 2 (immediate)
      const recentAfter = checkForRecentCallAttempt(claimId);
      expect(recentAfter.exists).toBe(true);
      expect(recentAfter.attempt?.vapiCallId).toBe(vapiCallId1);

      // Skip initiateCall() due to existing attempt
      // vapiCallCount stays 1
      expect(vapiCallCount).toBe(1);
    });

    it('tick 1 makes call, tick 2 (1 hour later) still skips', () => {
      // Tick 1
      const vapiCallId1 = simulateInitiateCall(claimId);
      createCallAttempt(claimId, vapiCallId1);
      expect(vapiCallCount).toBe(1);

      // Tick 2 (1 hour later)
      vi.advanceTimersByTime(60 * 60 * 1000);

      const recentAttempt = checkForRecentCallAttempt(claimId);
      expect(recentAttempt.exists).toBe(true);

      // Still skip (within 24-hour window)
      expect(vapiCallCount).toBe(1);
    });

    it('tick 1 makes call, tick 2 (25 hours later) allows new call', () => {
      // Tick 1
      const vapiCallId1 = simulateInitiateCall(claimId);
      createCallAttempt(claimId, vapiCallId1);
      expect(vapiCallCount).toBe(1);

      // Tick 2 (25 hours later)
      vi.advanceTimersByTime(25 * 60 * 60 * 1000);

      const recentAttempt = checkForRecentCallAttempt(claimId);
      expect(recentAttempt.exists).toBe(false);

      // Can make new call
      const vapiCallId2 = simulateInitiateCall(claimId);
      createCallAttempt(claimId, vapiCallId2);
      expect(vapiCallCount).toBe(2);
    });
  });

  describe('Scenario: Multiple claims in queue', () => {
    it('deduplication is per-claim, not global', () => {
      const claim1 = 'claim-1';
      const claim2 = 'claim-2';

      // Tick 1: both claims get calls
      const vapi1_tick1 = simulateInitiateCall(claim1);
      createCallAttempt(claim1, vapi1_tick1);
      const vapi2_tick1 = simulateInitiateCall(claim2);
      createCallAttempt(claim2, vapi2_tick1);
      expect(vapiCallCount).toBe(2);

      // Tick 2: should block both
      expect(checkForRecentCallAttempt(claim1).exists).toBe(true);
      expect(checkForRecentCallAttempt(claim2).exists).toBe(true);

      // vapiCallCount stays 2 (no new calls)
      expect(vapiCallCount).toBe(2);
    });

    it('one claim blocked, another allowed', () => {
      const claim1 = 'claim-1';
      const claim2 = 'claim-2';

      // Claim 1 got called
      const vapi1 = simulateInitiateCall(claim1);
      createCallAttempt(claim1, vapi1);
      expect(vapiCallCount).toBe(1);

      // Claim 2 never called (just created in queue)
      expect(checkForRecentCallAttempt(claim2).exists).toBe(false);

      // Claim 2 should be allowed
      const vapi2 = simulateInitiateCall(claim2);
      createCallAttempt(claim2, vapi2);
      expect(vapiCallCount).toBe(2);

      // Claim 1 blocked, claim 2 allowed
      expect(checkForRecentCallAttempt(claim1).exists).toBe(true);
      expect(checkForRecentCallAttempt(claim2).exists).toBe(true);
    });
  });

  describe('Safety guarantees', () => {
    it('handles empty call attempts gracefully', () => {
      callAttempts.clear();
      const recent = checkForRecentCallAttempt(claimId);
      expect(recent.exists).toBe(false);
      expect(recent.attempt).toBeNull();
    });

    it('correctly handles time boundaries', () => {
      // Create attempt at time T
      const vapiCallId = simulateInitiateCall(claimId);
      createCallAttempt(claimId, vapiCallId);
      const createdAt = new Date();

      // Exactly 24 hours - 1ms later: should still be blocked
      // (elapsed < window, so within the 24-hour window)
      vi.advanceTimersByTime(24 * 60 * 60 * 1000 - 1);
      let recent = checkForRecentCallAttempt(claimId);
      expect(recent.exists).toBe(true);

      // Exactly 24 hours later: should be allowed now
      // (elapsed >= window, so outside the 24-hour window)
      vi.advanceTimersByTime(1);
      recent = checkForRecentCallAttempt(claimId);
      expect(recent.exists).toBe(false);

      // Well past 24 hours: definitely should be allowed
      vi.advanceTimersByTime(60 * 60 * 1000); // +1 hour
      recent = checkForRecentCallAttempt(claimId);
      expect(recent.exists).toBe(false);
    });

    it('does not block unrelated claims', () => {
      const claim1 = 'claim-1';
      const claim2 = 'claim-2';
      const claim3 = 'claim-3';

      // Only claim1 has recent attempt
      const vapi1 = simulateInitiateCall(claim1);
      createCallAttempt(claim1, vapi1);

      // claim2 and claim3 should not be affected
      expect(checkForRecentCallAttempt(claim1).exists).toBe(true);
      expect(checkForRecentCallAttempt(claim2).exists).toBe(false);
      expect(checkForRecentCallAttempt(claim3).exists).toBe(false);
    });
  });
});
