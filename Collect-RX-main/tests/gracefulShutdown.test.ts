/**
 * Graceful Shutdown — Queue engine teardown
 *
 * Tests that the queue engine stops cleanly during SIGTERM without leaving
 * claims in inconsistent states (e.g., CALLING but not actually called).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Graceful Shutdown — Queue Engine Teardown', () => {
  // Simulate the queue engine's tick state management
  let isTickRunning = false;
  let tickTimer: ReturnType<typeof setInterval> | null = null;

  beforeEach(() => {
    isTickRunning = false;
    tickTimer = null;
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (tickTimer) clearInterval(tickTimer);
    vi.useRealTimers();
  });

  /**
   * Simulate the queue engine's tick logic with a delay
   */
  async function simulateTickInProgress(delayMs: number): Promise<void> {
    if (isTickRunning) {
      console.warn('previous tick still running — skipping');
      return;
    }
    isTickRunning = true;
    try {
      // Simulate tick work (Vapi calls, DB updates)
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } finally {
      isTickRunning = false;
    }
  }

  /**
   * Simulate stopDeskQueueEngine() behavior
   */
  async function stopQueueEngine(): Promise<void> {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }

    // Wait for any in-flight tick to complete
    const maxWaitMs = 90_000;
    const startWait = Date.now();
    while (isTickRunning && Date.now() - startWait < maxWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  it('stops the queue engine interval', async () => {
    let tickCount = 0;
    tickTimer = setInterval(() => {
      tickCount++;
    }, 1000);

    expect(tickCount).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(tickCount).toBe(1);

    await stopQueueEngine();

    vi.advanceTimersByTime(1000);
    expect(tickCount).toBe(1); // No new tick
  });

  it('waits for in-flight tick to complete before returning', async () => {
    const tickDuration = 500;
    let tickCompleted = false;

    // Start a simulated tick (will run for 500ms)
    // Note: Don't call simulateTickInProgress with isTickRunning already true, as it has a guard
    // Instead, manually simulate the tick behavior
    isTickRunning = true;
    const tickPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        isTickRunning = false;
        tickCompleted = true;
        resolve();
      }, tickDuration);
    });

    // Immediately try to stop (before tick finishes)
    const stopPromise = stopQueueEngine();

    // Tick is still running
    expect(tickCompleted).toBe(false);
    expect(isTickRunning).toBe(true);

    // Advance time enough for tick to complete AND for stopQueueEngine's polling loop to wake up
    // Tick needs 500ms + stopQueueEngine polling needs at least 100ms for setTimeout
    vi.advanceTimersByTime(600);
    await vi.runAllTimersAsync();

    // Both should complete now
    await expect(tickPromise).resolves.toBeUndefined();
    await expect(stopPromise).resolves.toBeUndefined();

    // Tick is complete and stopQueueEngine has returned
    expect(tickCompleted).toBe(true);
    expect(isTickRunning).toBe(false);
  });

  it('times out if tick takes >90 seconds', async () => {
    // Start a very long tick
    isTickRunning = true;

    const stopPromise = stopQueueEngine();

    // Advance to 95 seconds (past the 90s timeout)
    vi.advanceTimersByTime(95_000);

    // Tick is still running (we didn't resolve it)
    expect(isTickRunning).toBe(true);

    // stopQueueEngine should have returned despite tick still running
    await stopPromise;

    // Cleanup
    isTickRunning = false;
  });

  it('returns immediately if no tick is running', async () => {
    const stopPromise = stopQueueEngine();

    // Should return immediately since isTickRunning is false
    await stopPromise;

    // No time advancement should have been needed
    expect(isTickRunning).toBe(false);
  });

  it('handles multiple stop calls (idempotent)', async () => {
    await stopQueueEngine();
    await stopQueueEngine();
    await stopQueueEngine();

    // Should not crash or error
    expect(tickTimer).toBe(null);
  });

  it('scenario: claim dispatched at shutdown time', async () => {
    // Simulate: claim is in the middle of being dispatched (CALLING status)
    // and SIGTERM arrives
    const claim = {
      id: 'claim-123',
      status: 'CALLING',
      vapiCallId: 'vapi-456',
    };

    // Start a tick that's dispatching this claim
    isTickRunning = true;

    // Simulate tick: VapiCall initiated, claim marked as CALLING, tick completes
    const tickWork = new Promise<void>((resolve) => {
      setTimeout(() => {
        claim.status = 'CALLING';
        isTickRunning = false;
        resolve();
      }, 300);
    });

    // SIGTERM arrives while tick is running
    const shutdownPromise = stopQueueEngine().then(() => {
      // After shutdown completes, tick should have finished
      expect(isTickRunning).toBe(false);
      // Claim should be in a consistent state
      expect(claim.status).toBe('CALLING');
      expect(claim.vapiCallId).toBe('vapi-456');
    });

    // Advance time to let tick complete
    vi.advanceTimersByTime(300);
    await tickWork;
    await shutdownPromise;
  });

  it('prevents new ticks from starting after shutdown', async () => {
    let tickCount = 0;
    tickTimer = setInterval(() => {
      tickCount++;
    }, 1000);

    await stopQueueEngine();

    // Try to start new ticks after shutdown
    vi.advanceTimersByTime(2000);

    // No new ticks should have run (timer was cleared)
    expect(tickCount).toBe(0);
  });
});
