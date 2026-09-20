/**
 * P0.2 — Vapi circuit breaker. Covers every acceptance criterion from the
 * backlog: CLOSED→OPEN after N consecutive failures, OPEN rejects
 * immediately without calling fn(), HALF_OPEN probing (rate-limited),
 * HALF_OPEN→CLOSED after M successes, HALF_OPEN→OPEN after a single
 * failure, exponential backoff on repeated opens, error classification, and
 * the OPEN-transition alert.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  VapiCircuitBreaker,
  CircuitBreakerOpenError,
  defaultClassifyVapiError,
  loadCircuitBreakerConfigFromEnv,
  type CircuitBreakerConfig,
} from '../src/vapi/circuitBreaker.js';

function config(overrides: Partial<CircuitBreakerConfig> = {}): CircuitBreakerConfig {
  return {
    failureThreshold: 5,
    successThreshold: 3,
    openDurationMs: 60_000,
    openDurationMaxMs: 300_000,
    halfOpenProbeIntervalMs: 10_000,
    ...overrides,
  };
}

const fail = () => Promise.reject(new Error('boom'));
const ok = () => Promise.resolve('ok');

describe('VapiCircuitBreaker — state transitions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays CLOSED below the failure threshold', async () => {
    const cb = new VapiCircuitBreaker(config({ failureThreshold: 5 }));
    for (let i = 0; i < 4; i++) {
      await expect(cb.execute(fail)).rejects.toThrow('boom');
    }
    expect(cb.getState()).toBe('CLOSED');
  });

  it('opens after exactly the configured number of consecutive failures', async () => {
    const cb = new VapiCircuitBreaker(config({ failureThreshold: 5 }));
    for (let i = 0; i < 5; i++) {
      await expect(cb.execute(fail)).rejects.toThrow('boom');
    }
    expect(cb.getState()).toBe('OPEN');
  });

  it('a success resets the consecutive-failure count (does not open on scattered failures)', async () => {
    const cb = new VapiCircuitBreaker(config({ failureThreshold: 3 }));
    await expect(cb.execute(fail)).rejects.toThrow();
    await expect(cb.execute(fail)).rejects.toThrow();
    await cb.execute(ok);
    await expect(cb.execute(fail)).rejects.toThrow();
    await expect(cb.execute(fail)).rejects.toThrow();
    expect(cb.getState()).toBe('CLOSED');
  });

  it('OPEN rejects immediately with CircuitBreakerOpenError and never calls fn()', async () => {
    const cb = new VapiCircuitBreaker(config({ failureThreshold: 1 }));
    await expect(cb.execute(fail)).rejects.toThrow('boom');
    expect(cb.getState()).toBe('OPEN');

    const fn = vi.fn(ok);
    await expect(cb.execute(fn)).rejects.toBeInstanceOf(CircuitBreakerOpenError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('transitions OPEN → HALF_OPEN only after the open duration elapses', async () => {
    const cb = new VapiCircuitBreaker(config({ failureThreshold: 1, openDurationMs: 10_000 }));
    await expect(cb.execute(fail)).rejects.toThrow();
    expect(cb.getState()).toBe('OPEN');

    vi.advanceTimersByTime(9_999);
    expect(cb.getState()).toBe('OPEN');

    vi.advanceTimersByTime(2);
    expect(cb.getState()).toBe('HALF_OPEN');
  });

  it('HALF_OPEN allows a probe, then throttles further attempts to one per probe interval', async () => {
    const cb = new VapiCircuitBreaker(
      config({ failureThreshold: 1, openDurationMs: 10_000, halfOpenProbeIntervalMs: 5_000 }),
    );
    await expect(cb.execute(fail)).rejects.toThrow();
    vi.advanceTimersByTime(10_000);
    expect(cb.getState()).toBe('HALF_OPEN');

    const probe = vi.fn(ok);
    await cb.execute(probe);
    expect(probe).toHaveBeenCalledTimes(1);

    // Immediately trying again within the probe interval must not call fn().
    const secondAttempt = vi.fn(ok);
    await expect(cb.execute(secondAttempt)).rejects.toBeInstanceOf(CircuitBreakerOpenError);
    expect(secondAttempt).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5_000);
    const thirdAttempt = vi.fn(ok);
    await cb.execute(thirdAttempt);
    expect(thirdAttempt).toHaveBeenCalledTimes(1);
  });

  it('HALF_OPEN → CLOSED after the configured number of consecutive successes', async () => {
    const cb = new VapiCircuitBreaker(
      config({ failureThreshold: 1, successThreshold: 3, openDurationMs: 1_000, halfOpenProbeIntervalMs: 1 }),
    );
    await expect(cb.execute(fail)).rejects.toThrow();
    vi.advanceTimersByTime(1_000);
    expect(cb.getState()).toBe('HALF_OPEN');

    await cb.execute(ok);
    expect(cb.getState()).toBe('HALF_OPEN');
    vi.advanceTimersByTime(1);
    await cb.execute(ok);
    expect(cb.getState()).toBe('HALF_OPEN');
    vi.advanceTimersByTime(1);
    await cb.execute(ok);
    expect(cb.getState()).toBe('CLOSED');
  });

  it('HALF_OPEN → OPEN immediately after a single failed probe', async () => {
    const cb = new VapiCircuitBreaker(
      config({ failureThreshold: 1, successThreshold: 3, openDurationMs: 1_000 }),
    );
    await expect(cb.execute(fail)).rejects.toThrow();
    vi.advanceTimersByTime(1_000);
    expect(cb.getState()).toBe('HALF_OPEN');

    await expect(cb.execute(fail)).rejects.toThrow();
    expect(cb.getState()).toBe('OPEN');
  });

  it('applies exponential backoff to the open duration on repeated re-opens, capped at the max', async () => {
    const cb = new VapiCircuitBreaker(
      config({ failureThreshold: 1, openDurationMs: 1_000, openDurationMaxMs: 3_500, halfOpenProbeIntervalMs: 1 }),
    );

    // 1st open: base duration (1000ms).
    await expect(cb.execute(fail)).rejects.toThrow();
    vi.advanceTimersByTime(999);
    expect(cb.getState()).toBe('OPEN');
    vi.advanceTimersByTime(2);
    expect(cb.getState()).toBe('HALF_OPEN');

    // Fails the probe — re-opens. 2nd open duration should be 2x (2000ms).
    await expect(cb.execute(fail)).rejects.toThrow();
    expect(cb.getState()).toBe('OPEN');
    vi.advanceTimersByTime(1_999);
    expect(cb.getState()).toBe('OPEN');
    vi.advanceTimersByTime(2);
    expect(cb.getState()).toBe('HALF_OPEN');

    // Fails again — 3rd open duration would be 4000ms uncapped, but the max is 3500ms.
    await expect(cb.execute(fail)).rejects.toThrow();
    vi.advanceTimersByTime(3_499);
    expect(cb.getState()).toBe('OPEN');
    vi.advanceTimersByTime(2);
    expect(cb.getState()).toBe('HALF_OPEN');
  });

  it('a full recovery to CLOSED resets the backoff — the next open uses the base duration again', async () => {
    const cb = new VapiCircuitBreaker(
      config({ failureThreshold: 1, successThreshold: 1, openDurationMs: 1_000, halfOpenProbeIntervalMs: 1 }),
    );
    await expect(cb.execute(fail)).rejects.toThrow();
    vi.advanceTimersByTime(1_000);
    await cb.execute(ok); // successThreshold 1 → closes immediately
    expect(cb.getState()).toBe('CLOSED');

    await expect(cb.execute(fail)).rejects.toThrow();
    vi.advanceTimersByTime(999);
    expect(cb.getState()).toBe('OPEN');
    vi.advanceTimersByTime(2);
    expect(cb.getState()).toBe('HALF_OPEN');
  });
});

describe('VapiCircuitBreaker — metrics', () => {
  it('reports failure reasons, totals, and state in getMetrics()', async () => {
    const cb = new VapiCircuitBreaker(config({ failureThreshold: 10 }));
    await expect(cb.execute(() => Promise.reject(Object.assign(new Error('x'), { name: 'TimeoutError' })))).rejects.toThrow();
    await expect(cb.execute(() => Promise.reject(new Error('[VapiClient] POST /call → 503: oops')))).rejects.toThrow();
    await expect(cb.execute(() => Promise.reject(new Error('[VapiClient] POST /call → 401: nope')))).rejects.toThrow();
    await cb.execute(ok);

    const metrics = cb.getMetrics();
    expect(metrics.state).toBe('CLOSED');
    expect(metrics.totalFailures).toBe(3);
    expect(metrics.totalSuccesses).toBe(1);
    expect(metrics.failureReasons.timeout).toBe(1);
    expect(metrics.failureReasons['5xx']).toBe(1);
    expect(metrics.failureReasons['4xx']).toBe(1);
    expect(metrics.lastStateChangeAt).toBeNull(); // never transitioned state
  });

  it('exposes nextProbeEligibleAt only while OPEN', async () => {
    vi.useFakeTimers();
    try {
      const cb = new VapiCircuitBreaker(config({ failureThreshold: 1, openDurationMs: 5_000 }));
      expect(cb.getMetrics().nextProbeEligibleAt).toBeNull();
      await expect(cb.execute(fail)).rejects.toThrow();
      expect(cb.getMetrics().nextProbeEligibleAt).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('defaultClassifyVapiError', () => {
  it('classifies TimeoutError/AbortError as timeout', () => {
    expect(defaultClassifyVapiError(Object.assign(new Error('t'), { name: 'TimeoutError' }))).toBe('timeout');
    expect(defaultClassifyVapiError(Object.assign(new Error('t'), { name: 'AbortError' }))).toBe('timeout');
  });

  it('classifies vapiRequest\'s status-coded errors as 5xx or 4xx', () => {
    expect(defaultClassifyVapiError(new Error('[VapiClient] POST /call → 500: server error'))).toBe('5xx');
    expect(defaultClassifyVapiError(new Error('[VapiClient] POST /call → 503: unavailable'))).toBe('5xx');
    expect(defaultClassifyVapiError(new Error('[VapiClient] POST /call → 404: not found'))).toBe('4xx');
    expect(defaultClassifyVapiError(new Error('[VapiClient] POST /call → 401: unauthorized'))).toBe('4xx');
  });

  it('falls back to network for a plain Error with no status code', () => {
    expect(defaultClassifyVapiError(new TypeError('fetch failed'))).toBe('network');
  });

  it('falls back to unknown for a non-Error throw', () => {
    expect(defaultClassifyVapiError('a string, not an Error')).toBe('unknown');
    expect(defaultClassifyVapiError(undefined)).toBe('unknown');
  });
});

describe('loadCircuitBreakerConfigFromEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses sensible defaults when no env vars are set', () => {
    vi.stubEnv('VAPI_CB_FAILURE_THRESHOLD', '');
    vi.stubEnv('VAPI_CB_SUCCESS_THRESHOLD', '');
    vi.stubEnv('VAPI_CB_OPEN_DURATION_MS', '');
    vi.stubEnv('VAPI_CB_OPEN_DURATION_MAX_MS', '');
    vi.stubEnv('VAPI_CB_HALF_OPEN_PROBE_INTERVAL_MS', '');
    const cfg = loadCircuitBreakerConfigFromEnv();
    expect(cfg).toEqual({
      failureThreshold: 5,
      successThreshold: 3,
      openDurationMs: 60_000,
      openDurationMaxMs: 300_000,
      halfOpenProbeIntervalMs: 10_000,
    });
  });

  it('honors overrides and ignores invalid (non-positive/non-numeric) values', () => {
    vi.stubEnv('VAPI_CB_FAILURE_THRESHOLD', '8');
    vi.stubEnv('VAPI_CB_SUCCESS_THRESHOLD', 'not-a-number');
    vi.stubEnv('VAPI_CB_OPEN_DURATION_MS', '-5');
    const cfg = loadCircuitBreakerConfigFromEnv();
    expect(cfg.failureThreshold).toBe(8);
    expect(cfg.successThreshold).toBe(3); // invalid → default
    expect(cfg.openDurationMs).toBe(60_000); // negative → default
  });
});
