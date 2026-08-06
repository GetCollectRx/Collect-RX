/**
 * Vapi API Instrumentation — Golden Signals
 *
 * Tracks request latency, timeout rate, and error patterns to enable
 * fast root-cause diagnosis when Vapi degrades.
 *
 * Metrics are single-process (use APM for multi-instance).
 * Circuit breaker state is in-memory; reset on process restart.
 */

export interface VapiCallMetric {
  practiceId?: string;
  claimId?: string;
  carrierId?: string;
  initiatedAt: Date;
  completedAt: Date;
  durationMs: number;
  status: 'success' | 'timeout' | 'error';
  errorMessage?: string;
}

const maxHistorySize = 100; // Keep last 100 calls in memory
let callHistory: VapiCallMetric[] = [];

export function recordVapiCall(metric: VapiCallMetric): void {
  callHistory.push(metric);
  if (callHistory.length > maxHistorySize) {
    callHistory = callHistory.slice(-maxHistorySize);
  }
}

export interface VapiMetricsSnapshot {
  /** Last N recorded calls (for diagnosis). */
  recentCalls: VapiCallMetric[];
  /** Calls in last 1 minute. */
  callsLastMinute: number;
  /** Timeout count in last 1 minute. */
  timeoutsLastMinute: number;
  /** Timeout percentage in last 1 minute. */
  timeoutRateLastMinute: number;
  /** Average duration in last 1 minute. */
  avgDurationMsLastMinute: number | null;
  /** P95 duration in last 1 minute. */
  p95DurationMsLastMinute: number | null;
  /** P99 duration in last 1 minute. */
  p99DurationMsLastMinute: number | null;
  /** Max observed duration in last 1 minute. */
  maxDurationMsLastMinute: number | null;
}

export function getVapiMetrics(): VapiMetricsSnapshot {
  const now = new Date();
  const oneMinuteAgo = new Date(now.getTime() - 60_000);

  const recentCalls = callHistory.filter((c) => c.initiatedAt >= oneMinuteAgo);

  const timeouts = recentCalls.filter((c) => c.status === 'timeout').length;
  const durations = recentCalls.map((c) => c.durationMs).sort((a, b) => a - b);

  const avgDuration = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : null;

  const p95Duration = durations.length
    ? durations[Math.floor(durations.length * 0.95)]
    : null;

  const p99Duration = durations.length
    ? durations[Math.floor(durations.length * 0.99)]
    : null;

  const maxDuration = durations.length ? durations[durations.length - 1] : null;

  return {
    recentCalls: callHistory.slice(-20), // Last 20 for the endpoint
    callsLastMinute: recentCalls.length,
    timeoutsLastMinute: timeouts,
    timeoutRateLastMinute: recentCalls.length ? timeouts / recentCalls.length : 0,
    avgDurationMsLastMinute: avgDuration,
    p95DurationMsLastMinute: p95Duration,
    p99DurationMsLastMinute: p99Duration,
    maxDurationMsLastMinute: maxDuration,
  };
}

/**
 * Reset metrics (for testing or manual recovery).
 */
export function resetVapiMetrics(): void {
  callHistory = [];
}
