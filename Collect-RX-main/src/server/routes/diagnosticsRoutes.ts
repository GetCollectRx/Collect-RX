/**
 * Diagnostics endpoints for on-call troubleshooting.
 *
 * These endpoints expose real-time system state for rapid root-cause diagnosis
 * during incidents. All are protected by session auth (admin/staff only).
 */

import { Router, Request, Response } from 'express';
import { getVapiMetrics } from '../../vapi/metrics.js';
import { getState as getCircuitBreakerState, resetCircuitBreaker } from '../../vapi/circuitBreaker.js';

const router = Router();

/**
 * GET /api/admin/diagnostics/vapi-health
 *
 * Real-time Vapi API health: response times, timeout rate, circuit breaker state.
 * For on-call: if timeout rate > 50% or circuit breaker is OPEN, Vapi API is degraded.
 */
router.get('/vapi-health', async (_req: Request, res: Response) => {
  const metrics = getVapiMetrics();
  const breaker = getCircuitBreakerState();

  res.json({
    timestamp: new Date().toISOString(),
    circuitBreaker: {
      state: breaker.state,
      consecutiveTimeouts: breaker.consecutiveTimeouts,
      lastStateChange: breaker.lastStateChange.toISOString(),
      nextRecoveryAttempt: breaker.nextRecoveryAttempt?.toISOString() ?? null,
      explanation: breaker.explanation,
    },
    latency: {
      // Millisecond percentiles in last 1 minute
      callsLastMinute: metrics.callsLastMinute,
      avgDurationMs: metrics.avgDurationMsLastMinute,
      p95DurationMs: metrics.p95DurationMsLastMinute,
      p99DurationMs: metrics.p99DurationMsLastMinute,
      maxDurationMs: metrics.maxDurationMsLastMinute,
    },
    reliability: {
      timeoutsLastMinute: metrics.timeoutsLastMinute,
      timeoutRateLastMinute: Math.round(metrics.timeoutRateLastMinute * 100),
      callsLastMinute: metrics.callsLastMinute,
    },
    recentCalls: metrics.recentCalls.slice(-20).map((call) => ({
      practiceId: call.practiceId,
      claimId: call.claimId,
      carrierId: call.carrierId,
      initiatedAt: call.initiatedAt.toISOString(),
      completedAt: call.completedAt.toISOString(),
      durationMs: call.durationMs,
      status: call.status,
      errorMessage: call.errorMessage,
    })),
    diagnosis: [
      metrics.timeoutRateLastMinute > 0.5
        ? {
            severity: 'high',
            issue: 'Vapi API has high timeout rate (>50%)',
            action: 'Check Vapi API status page or network connectivity to Vapi',
          }
        : null,
      breaker.state === 'OPEN'
        ? {
            severity: 'high',
            issue: 'Circuit breaker is OPEN — Vapi API degraded',
            action: `Check Vapi status page. Automatic recovery at ${breaker.nextRecoveryAttempt?.toISOString()}`,
          }
        : null,
      metrics.avgDurationMsLastMinute && metrics.avgDurationMsLastMinute > 15_000
        ? {
            severity: 'medium',
            issue: `Vapi response time elevated: ${metrics.avgDurationMsLastMinute}ms avg`,
            action: 'Vapi API may be degraded. Check queue health for stalled claims.',
          }
        : null,
    ].filter(Boolean),
  });
});

/**
 * POST /api/admin/diagnostics/vapi-reset-circuit-breaker
 *
 * Manually reset the Vapi circuit breaker (ops emergency recovery).
 * Use only after confirming Vapi API is healthy again.
 */
router.post('/vapi-reset-circuit-breaker', async (_req: Request, res: Response) => {
  resetCircuitBreaker();
  res.json({
    timestamp: new Date().toISOString(),
    action: 'Circuit breaker manually reset',
    state: getCircuitBreakerState(),
  });
});

export function createDiagnosticsRouter() {
  return router;
}
