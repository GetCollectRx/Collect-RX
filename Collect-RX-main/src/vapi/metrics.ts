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

  // Linear interpolation for percentiles (standard statistical method)
  const percentile = (arr: number[], p: number): number | null => {
    if (!arr.length) return null;
    const h = (p / 100) * (arr.length - 1);
    const lower = Math.floor(h);
    const upper = Math.ceil(h);
    if (lower === upper) return arr[lower];
    const weight = h - lower;
    return Math.round(arr[lower] * (1 - weight) + arr[upper] * weight);
  };

  const p95Duration = percentile(durations, 95);
  const p99Duration = percentile(durations, 99);
  const maxDuration = durations.length ? durations[durations.length - 1] : null;

  return {
    recentCalls: recentCalls.slice(-20), // Last 20 within 1-minute window
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
