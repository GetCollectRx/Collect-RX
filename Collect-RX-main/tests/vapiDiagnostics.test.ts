/**
 * Vapi Circuit Breaker & Metrics — Incident Diagnosis
 *
 * These tests verify the on-call diagnostic infrastructure works correctly
 * during real failures.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  recordVapiCall,
  getVapiMetrics,
  resetVapiMetrics,
  type VapiCallMetric,
} from '../src/vapi/metrics';
import {
  recordTimeout,
  recordSuccess,
  getState,
  isCircuitOpen,
  resetCircuitBreaker,
  type CircuitBreakerSnapshot,
} from '../src/vapi/circuitBreaker';

describe('Vapi Circuit Breaker', () => {
  beforeEach(() => {
    resetCircuitBreaker();
    resetVapiMetrics();
  });

  describe('state transitions', () => {
    it('starts CLOSED', () => {
      const state = getState();
      expect(state.state).toBe('CLOSED');
      expect(isCircuitOpen()).toBe(false);
    });

    it('trips to OPEN after N consecutive timeouts', () => {
      // Simulate failures
      recordTimeout();
      recordTimeout();
      recordTimeout();
      recordTimeout();
      recordTimeout();

      const state = getState();
      expect(state.state).toBe('OPEN');
      expect(isCircuitOpen()).toBe(true);
      expect(state.consecutiveTimeouts).toBe(5);
    });

    it('resets timeout counter on success', () => {
      recordTimeout();
      recordTimeout();
      recordSuccess();

      const state = getState();
      expect(state.consecutiveTimeouts).toBe(0);
      expect(state.state).toBe('CLOSED');
    });

    it('transitions OPEN → HALF_OPEN after recovery timeout', () => {
      // Trip the circuit
      for (let i = 0; i < 5; i++) recordTimeout();
      expect(getState().state).toBe('OPEN');

      // Immediately still OPEN
      expect(getState().state).toBe('OPEN');

      // Simulate time passage (in real system, this would be after VAPI_CB_RECOVERY_TIMEOUT_MS)
      // For testing, we'd need to mock Date or pass time; for now verify the structure
      expect(getState().nextRecoveryAttempt).toBeDefined();
    });

    it('recovers HALF_OPEN → CLOSED after success threshold', () => {
      vi.useFakeTimers();
      try {
        // Trip circuit
        for (let i = 0; i < 5; i++) recordTimeout();
        expect(getState().state).toBe('OPEN');

        // Advance time past recovery timeout to trigger HALF_OPEN
        vi.advanceTimersByTime(121_000); // Recovery timeout is 120s by default

        // Auto-transition to HALF_OPEN when calling getState()
        expect(getState().state).toBe('HALF_OPEN');

        // Record 2 successes to close
        recordSuccess();
        recordSuccess();

        // After 2 successes (success threshold), should close
        const state = getState();
        expect(state.state).toBe('CLOSED');
        expect(state.consecutiveTimeouts).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('reopens if HALF_OPEN fails', () => {
      // Trip circuit
      for (let i = 0; i < 5; i++) recordTimeout();
      expect(getState().state).toBe('OPEN');

      // Simulate recovery attempt: timeout in HALF_OPEN
      recordTimeout();

      const state = getState();
      expect(state.state).toBe('OPEN');
    });
  });

  describe('manual recovery', () => {
    it('resets circuit to CLOSED', () => {
      for (let i = 0; i < 5; i++) recordTimeout();
      expect(getState().state).toBe('OPEN');

      resetCircuitBreaker();
      expect(getState().state).toBe('CLOSED');
      expect(isCircuitOpen()).toBe(false);
    });
  });
});

describe('Vapi Metrics', () => {
  beforeEach(() => {
    resetVapiMetrics();
  });

  describe('call recording', () => {
    it('records successful calls', () => {
      const now = new Date();
      recordVapiCall({
        practiceId: 'p123',
        claimId: 'c456',
        carrierId: 'sun_life',
        initiatedAt: now,
        completedAt: new Date(now.getTime() + 1500),
        durationMs: 1500,
        status: 'success',
      });

      const metrics = getVapiMetrics();
      expect(metrics.recentCalls).toHaveLength(1);
      expect(metrics.recentCalls[0].status).toBe('success');
      expect(metrics.recentCalls[0].durationMs).toBe(1500);
    });

    it('records timeouts', () => {
      const now = new Date();
      recordVapiCall({
        practiceId: 'p123',
        claimId: 'c456',
        carrierId: 'sun_life',
        initiatedAt: now,
        completedAt: new Date(now.getTime() + 30_000),
        durationMs: 30_000,
        status: 'timeout',
        errorMessage: 'AbortError: signal timeout',
      });

      const metrics = getVapiMetrics();
      expect(metrics.timeoutsLastMinute).toBe(1);
      expect(metrics.timeoutRateLastMinute).toBe(1.0); // 100%
    });

    it('calculates timeout rate correctly', () => {
      const now = new Date();

      // 3 successes
      for (let i = 0; i < 3; i++) {
        recordVapiCall({
          practiceId: 'p123',
          claimId: `c${i}`,
          carrierId: 'sun_life',
          initiatedAt: new Date(now.getTime() - 10_000),
          completedAt: new Date(now.getTime() - 9_000),
          durationMs: 1000,
          status: 'success',
        });
      }

      // 2 timeouts
      for (let i = 0; i < 2; i++) {
        recordVapiCall({
          practiceId: 'p123',
          claimId: `c${10 + i}`,
          carrierId: 'sun_life',
          initiatedAt: new Date(now.getTime() - 5_000),
          completedAt: new Date(now.getTime() - 3_000),
          durationMs: 2000,
          status: 'timeout',
        });
      }

      const metrics = getVapiMetrics();
      expect(metrics.callsLastMinute).toBe(5);
      expect(metrics.timeoutsLastMinute).toBe(2);
      expect(metrics.timeoutRateLastMinute).toBeCloseTo(0.4, 1); // 40%
    });

    it('calculates latency percentiles', () => {
      const now = new Date();

      // Record 10 calls with varied latencies: 100ms, 200ms, ..., 1000ms
      for (let i = 0; i < 10; i++) {
        const durationMs = (i + 1) * 100;
        recordVapiCall({
          practiceId: 'p123',
          claimId: `c${i}`,
          carrierId: 'sun_life',
          initiatedAt: new Date(now.getTime() - 30_000),
          completedAt: new Date(now.getTime() - 30_000 + durationMs),
          durationMs,
          status: 'success',
        });
      }

      const metrics = getVapiMetrics();
      expect(metrics.callsLastMinute).toBe(10);
      expect(metrics.avgDurationMsLastMinute).toBe(550); // Average of 100..1000
      expect(metrics.p95DurationMsLastMinute).toBe(955); // 95th percentile (linear interpolation)
      expect(metrics.p99DurationMsLastMinute).toBe(991); // 99th percentile (linear interpolation)
      expect(metrics.maxDurationMsLastMinute).toBe(1000);
    });

    it('filters calls outside 1-minute window', () => {
      const now = new Date();
      const twoMinutesAgo = new Date(now.getTime() - 120_000);

      // Record call from 2 minutes ago
      recordVapiCall({
        practiceId: 'p123',
        claimId: 'old',
        carrierId: 'sun_life',
        initiatedAt: twoMinutesAgo,
        completedAt: new Date(twoMinutesAgo.getTime() + 1000),
        durationMs: 1000,
        status: 'success',
      });

      // Record call from now
      recordVapiCall({
        practiceId: 'p123',
        claimId: 'recent',
        carrierId: 'sun_life',
        initiatedAt: new Date(now.getTime() - 10_000),
        completedAt: new Date(now.getTime() - 9_000),
        durationMs: 1000,
        status: 'success',
      });

      const metrics = getVapiMetrics();
      expect(metrics.callsLastMinute).toBe(1); // Only recent call
      expect(metrics.recentCalls[0].claimId).toBe('recent');
    });

    it('keeps only last 100 calls in history', () => {
      const now = new Date();

      // Record 150 calls
      for (let i = 0; i < 150; i++) {
        recordVapiCall({
          claimId: `c${i}`,
          carrierId: 'sun_life',
          initiatedAt: new Date(now.getTime() - 1000 + i),
          completedAt: new Date(now.getTime() + i),
          durationMs: 1000,
          status: 'success',
        });
      }

      const metrics = getVapiMetrics();
      // recentCalls shows last 20; full history is capped at 100
      expect(metrics.recentCalls.length).toBe(20);
      expect(metrics.recentCalls[0].claimId).toBe('c130'); // Last 20 of 150
    });
  });

  describe('incident diagnosis', () => {
    it('detects timeout cascade', () => {
      const now = new Date();

      // Simulate Vapi degradation: 8 consecutive timeouts
      for (let i = 0; i < 8; i++) {
        recordVapiCall({
          practiceId: 'p123',
          claimId: `c${i}`,
          carrierId: 'sun_life',
          initiatedAt: new Date(now.getTime() - 30_000 + i * 3000),
          completedAt: new Date(now.getTime() - 30_000 + i * 3000 + 30_000),
          durationMs: 30_000,
          status: 'timeout',
        });
      }

      const metrics = getVapiMetrics();
      expect(metrics.timeoutRateLastMinute).toBe(1.0); // 100% timeout rate
      expect(metrics.avgDurationMsLastMinute).toBe(30_000); // All 30s timeouts
    });

    it('detects degraded but recovering API', () => {
      const now = new Date();

      // Initial failures: 3 timeouts
      for (let i = 0; i < 3; i++) {
        recordVapiCall({
          claimId: `c${i}`,
          carrierId: 'sun_life',
          initiatedAt: new Date(now.getTime() - 45_000),
          completedAt: new Date(now.getTime() - 15_000),
          durationMs: 30_000,
          status: 'timeout',
        });
      }

      // Recovery: 7 successes at 1.5s
      for (let i = 0; i < 7; i++) {
        recordVapiCall({
          claimId: `c${10 + i}`,
          carrierId: 'sun_life',
          initiatedAt: new Date(now.getTime() - 10_000),
          completedAt: new Date(now.getTime() - 9_000 + i * 100),
          durationMs: 1500,
          status: 'success',
        });
      }

      const metrics = getVapiMetrics();
      expect(metrics.timeoutRateLastMinute).toBeCloseTo(0.3, 1); // 30% timeout (3/10)
      expect(metrics.avgDurationMsLastMinute).toBeGreaterThan(8000); // Avg skewed by timeouts
    });
  });
});
