/**
 * P6-03: in-process golden-signal style counters (single instance).
 * For multi-instance / p95 in prod, use your APM (Sentry) or a metrics backend.
 */

let requestCount = 0;
let error5xx = 0;
let latencySumMs = 0;
let bootedAt = new Date().toISOString();

export function markBoot(): void {
  bootedAt = new Date().toISOString();
}

export function recordHttpRequest(latencyMs: number, status: number): void {
  requestCount += 1;
  latencySumMs += latencyMs;
  if (status >= 500) {
    error5xx += 1;
  }
}

export function getMetrics() {
  const avgLatencyMs = requestCount ? Math.round(latencySumMs / requestCount) : 0;
  return {
    http: {
      requests: requestCount,
      errors5xx: error5xx,
      avgLatencyMs,
    },
    bootedAt,
    processUptimeSec: Math.floor(process.uptime()),
  };
}
