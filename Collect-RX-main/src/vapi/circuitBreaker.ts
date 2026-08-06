/**
 * Vapi API Circuit Breaker
 *
 * Prevents cascade failure when Vapi API is slow or down.
 * Trips after N consecutive timeouts, fast-fails new requests, and auto-recovers
 * after cooldown.
 *
 * State: CLOSED (normal) → OPEN (degraded, fast-fail) → HALF_OPEN (testing) → CLOSED
 *
 * In-memory; resets on process restart. For persistent state, store in Redis or DB.
 */

import logger from '../logger.cjs';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerSnapshot {
  state: CircuitState;
  consecutiveTimeouts: number;
  lastStateChange: Date;
  nextRecoveryAttempt?: Date;
  explanation: string;
}

interface CircuitBreakerConfig {
  /** Trip after this many consecutive timeouts. */
  failureThreshold: number;
  /** Milliseconds to wait before attempting recovery (HALF_OPEN). */
  recoveryTimeoutMs: number;
  /** Allow this many successful calls in HALF_OPEN before closing. */
  successThreshold: number;
}

const config: CircuitBreakerConfig = {
  failureThreshold: Math.max(3, Number(process.env.VAPI_CB_FAILURE_THRESHOLD || 5)),
  recoveryTimeoutMs: Math.max(30_000, Number(process.env.VAPI_CB_RECOVERY_TIMEOUT_MS || 120_000)),
  successThreshold: 2,
};

let state: CircuitState = 'CLOSED';
let consecutiveTimeouts = 0;
let consecutiveSuccesses = 0;
let lastStateChange = new Date();
let nextRecoveryAttempt: Date | null = null;

/**
 * Call this when a Vapi request TIMES OUT (AbortError, not general error).
 */
export function recordTimeout(): void {
  consecutiveTimeouts += 1;
  consecutiveSuccesses = 0;

  if (state === 'CLOSED' && consecutiveTimeouts >= config.failureThreshold) {
    state = 'OPEN';
    lastStateChange = new Date();
    nextRecoveryAttempt = new Date(lastStateChange.getTime() + config.recoveryTimeoutMs);

    logger.error('[circuitBreaker] VAPI CIRCUIT BREAKER TRIPPED', {
      state,
      consecutiveTimeouts,
      willAttemptRecovery: nextRecoveryAttempt.toISOString(),
    });
  } else if (state === 'HALF_OPEN') {
    // Failure in HALF_OPEN → reopen
    state = 'OPEN';
    nextRecoveryAttempt = new Date(Date.now() + config.recoveryTimeoutMs);
    consecutiveTimeouts = 1;
    consecutiveSuccesses = 0;

    logger.error('[circuitBreaker] VAPI CIRCUIT BREAKER REOPENED (failed during recovery)', {
      state,
      nextRecoveryAttempt: nextRecoveryAttempt.toISOString(),
    });
  }
}

/**
 * Call this when a Vapi request SUCCEEDS.
 */
export function recordSuccess(): void {
  consecutiveTimeouts = 0;

  if (state === 'HALF_OPEN') {
    consecutiveSuccesses += 1;
    if (consecutiveSuccesses >= config.successThreshold) {
      state = 'CLOSED';
      lastStateChange = new Date();
      nextRecoveryAttempt = null;
      consecutiveSuccesses = 0;

      logger.warn('[circuitBreaker] VAPI CIRCUIT BREAKER CLOSED (recovered)', {
        state,
        recoveredAt: lastStateChange.toISOString(),
      });
    }
  }
}

/**
 * Check current state. If OPEN and recovery timeout expired, attempt half-open.
 */
export function getState(): CircuitBreakerSnapshot {
  const now = new Date();

  // Auto-transition OPEN → HALF_OPEN when recovery timeout expires
  if (state === 'OPEN' && nextRecoveryAttempt && now >= nextRecoveryAttempt) {
    state = 'HALF_OPEN';
    consecutiveSuccesses = 0;
    lastStateChange = now;

    logger.warn('[circuitBreaker] VAPI CIRCUIT BREAKER HALF_OPEN (attempting recovery)', {
      state,
      transitionedAt: now.toISOString(),
    });
  }

  const explanation =
    state === 'CLOSED'
      ? 'Vapi API is healthy'
      : state === 'OPEN'
        ? `Vapi API degraded (${consecutiveTimeouts} consecutive timeouts). Fast-failing new requests. Recovery attempt at ${nextRecoveryAttempt?.toISOString()}`
        : `Vapi API testing recovery (${consecutiveSuccesses}/${config.successThreshold} success threshold)`;

  return {
    state,
    consecutiveTimeouts,
    lastStateChange,
    nextRecoveryAttempt: nextRecoveryAttempt ?? undefined,
    explanation,
  };
}

/**
 * Should a new call be rejected due to circuit breaker?
 */
export function isCircuitOpen(): boolean {
  getState(); // Auto-transition if needed
  return state === 'OPEN';
}

/**
 * Manual recovery (for ops dashboard).
 */
export function resetCircuitBreaker(): void {
  state = 'CLOSED';
  consecutiveTimeouts = 0;
  consecutiveSuccesses = 0;
  nextRecoveryAttempt = null;
  lastStateChange = new Date();

  logger.warn('[circuitBreaker] VAPI CIRCUIT BREAKER MANUALLY RESET', {
    state,
    resetAt: lastStateChange.toISOString(),
  });
}
