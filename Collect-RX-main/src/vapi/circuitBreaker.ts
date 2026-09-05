/**
 * Circuit breaker for outbound Vapi API calls (src/vapi/client.ts's single
 * vapiRequest() choke point). Existing protection is a 30s hard timeout per
 * request (VAPI_HTTP_TIMEOUT_MS) plus queueEngine's isTickRunning guard and
 * slot budget — none of that stops the queue from spending a full 60s tick
 * dialing Vapi over and over while it's degraded. This adds fail-fast: once
 * Vapi looks broken, stop trying for a while instead of hammering it (and
 * blocking the tick) on every claim.
 *
 * Scope: this only wraps src/vapi/client.ts's HTTP calls. It has no
 * awareness of Stripe, SendGrid, the database, or CARRIER_BLOCK — those are
 * separate systems and must keep working even if Vapi's breaker is OPEN.
 */
import { dispatchOpsAlert } from '../server/observability/opsAlerts.js';
import { logger } from '../server/observability/logger.js';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
export type FailureReason = 'timeout' | '5xx' | '4xx' | 'network' | 'unknown';

export class CircuitBreakerOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

export interface CircuitBreakerConfig {
  /** Consecutive failures (while CLOSED) before the breaker opens. */
  failureThreshold: number;
  /** Consecutive successes (while HALF_OPEN) before the breaker closes. */
  successThreshold: number;
  /** Base duration the breaker stays OPEN before allowing a HALF_OPEN probe. */
  openDurationMs: number;
  /** Ceiling for the exponential backoff applied to repeated re-opens. */
  openDurationMaxMs: number;
  /** Minimum spacing between HALF_OPEN probe attempts. */
  halfOpenProbeIntervalMs: number;
}

export function loadCircuitBreakerConfigFromEnv(): CircuitBreakerConfig {
  const num = (name: string, fallback: number) => {
    const raw = Number(process.env[name]);
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  };
  return {
    failureThreshold: num('VAPI_CB_FAILURE_THRESHOLD', 5),
    successThreshold: num('VAPI_CB_SUCCESS_THRESHOLD', 3),
    openDurationMs: num('VAPI_CB_OPEN_DURATION_MS', 60_000),
    openDurationMaxMs: num('VAPI_CB_OPEN_DURATION_MAX_MS', 300_000),
    halfOpenProbeIntervalMs: num('VAPI_CB_HALF_OPEN_PROBE_INTERVAL_MS', 10_000),
  };
}

export interface CircuitBreakerMetrics {
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  totalFailures: number;
  totalSuccesses: number;
  failureReasons: Record<FailureReason, number>;
  openCount: number;
  lastStateChangeAt: string | null;
  /** Only meaningful while OPEN — when a HALF_OPEN probe becomes eligible. */
  nextProbeEligibleAt: string | null;
}

/** Classifies vapiRequest()'s thrown errors — see src/vapi/client.ts. */
export function defaultClassifyVapiError(err: unknown): FailureReason {
  if (err instanceof Error) {
    const name = (err as { name?: string }).name;
    if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
    const statusMatch = /→ (\d{3}):/.exec(err.message);
    if (statusMatch) {
      const status = Number(statusMatch[1]);
      if (status >= 500) return '5xx';
      if (status >= 400) return '4xx';
    }
    // VapiAmbiguousOutcomeError's own .name masks the fetch failure it wraps
    // (timeout vs. a generic network error) — classify by the original cause
    // it carries (duck-typed as `originalCause` rather than imported, since
    // src/vapi/client.ts already imports this module) when this error's own
    // name/message don't already resolve to a reason above.
    const originalCause = (err as { originalCause?: unknown }).originalCause;
    if (originalCause instanceof Error) {
      return defaultClassifyVapiError(originalCause);
    }
    return 'network';
  }
  return 'unknown';
}

export class VapiCircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private failureReasons: Record<FailureReason, number> = {
    timeout: 0,
    '5xx': 0,
    '4xx': 0,
    network: 0,
    unknown: 0,
  };
  private openedAt: number | null = null;
  private openCount = 0;
  private lastProbeAt: number | null = null;
  private lastStateChangeAt: number | null = null;

  constructor(
    private readonly config: CircuitBreakerConfig,
    private readonly onStateChange?: (from: CircuitState, to: CircuitState) => void,
  ) {}

  /** Exponential backoff on repeated opens, capped at openDurationMaxMs. */
  private currentOpenDurationMs(): number {
    const scaled = this.config.openDurationMs * Math.pow(2, Math.max(0, this.openCount - 1));
    return Math.min(scaled, this.config.openDurationMaxMs);
  }

  /** OPEN → HALF_OPEN once the (backed-off) open duration has elapsed. */
  private maybeTransitionFromOpen(): void {
    if (this.state !== 'OPEN' || this.openedAt === null) return;
    if (Date.now() - this.openedAt >= this.currentOpenDurationMs()) {
      this.transitionTo('HALF_OPEN');
    }
  }

  private transitionTo(next: CircuitState): void {
    const prev = this.state;
    if (prev === next) return;
    this.state = next;
    this.lastStateChangeAt = Date.now();

    if (next === 'OPEN') {
      this.openedAt = Date.now();
      this.openCount += 1;
      this.lastProbeAt = null;
    } else if (next === 'CLOSED') {
      this.consecutiveFailures = 0;
      this.consecutiveSuccesses = 0;
      this.openCount = 0;
      this.openedAt = null;
    } else if (next === 'HALF_OPEN') {
      this.consecutiveFailures = 0;
      this.consecutiveSuccesses = 0;
    }

    this.onStateChange?.(prev, next);
  }

  getState(): CircuitState {
    this.maybeTransitionFromOpen();
    return this.state;
  }

  getMetrics(): CircuitBreakerMetrics {
    this.maybeTransitionFromOpen();
    const nextProbeEligibleAt =
      this.state === 'OPEN' && this.openedAt !== null
        ? new Date(this.openedAt + this.currentOpenDurationMs()).toISOString()
        : null;
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      failureReasons: { ...this.failureReasons },
      openCount: this.openCount,
      lastStateChangeAt: this.lastStateChangeAt ? new Date(this.lastStateChangeAt).toISOString() : null,
      nextProbeEligibleAt,
    };
  }

  private onSuccess(): void {
    this.totalSuccesses += 1;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses += 1;
    if (this.state === 'HALF_OPEN' && this.consecutiveSuccesses >= this.config.successThreshold) {
      this.transitionTo('CLOSED');
    }
  }

  private onFailure(reason: FailureReason): void {
    this.totalFailures += 1;
    this.failureReasons[reason] += 1;
    this.consecutiveSuccesses = 0;
    this.consecutiveFailures += 1;

    if (this.state === 'HALF_OPEN') {
      this.transitionTo('OPEN');
      return;
    }
    if (this.state === 'CLOSED' && this.consecutiveFailures >= this.config.failureThreshold) {
      this.transitionTo('OPEN');
    }
  }

  /**
   * Runs fn() through the breaker. Throws CircuitBreakerOpenError without
   * calling fn() at all when OPEN, or when HALF_OPEN and a probe was already
   * sent within halfOpenProbeIntervalMs — callers must treat this the same
   * as any other dispatch failure (defer/skip), not retry inline.
   */
  async execute<T>(fn: () => Promise<T>, classify: (err: unknown) => FailureReason = defaultClassifyVapiError): Promise<T> {
    this.maybeTransitionFromOpen();

    if (this.state === 'OPEN') {
      throw new CircuitBreakerOpenError('Vapi circuit breaker is OPEN — refusing call');
    }

    if (this.state === 'HALF_OPEN') {
      const now = Date.now();
      if (this.lastProbeAt !== null && now - this.lastProbeAt < this.config.halfOpenProbeIntervalMs) {
        throw new CircuitBreakerOpenError(
          'Vapi circuit breaker is HALF_OPEN — waiting for the next probe interval',
        );
      }
      this.lastProbeAt = now;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(classify(err));
      throw err;
    }
  }
}

function onVapiCircuitStateChange(from: CircuitState, to: CircuitState): void {
  if (to !== 'OPEN') return;
  void dispatchOpsAlert({
    alertId: 'vapi_circuit_open',
    detail: `Vapi circuit breaker transitioned ${from} → OPEN after repeated failures.`,
    source: 'vapi-circuit-breaker',
  }).catch((err) => {
    logger.error('[vapiCircuitBreaker] failed to dispatch vapi_circuit_open alert', { error: err });
  });
}

/** Process-wide singleton — src/vapi/client.ts wraps every request through this. */
export const vapiCircuitBreaker = new VapiCircuitBreaker(
  loadCircuitBreakerConfigFromEnv(),
  onVapiCircuitStateChange,
);
