/**
 * P1.2 — event-loop lag tracking, backing GET /api/health/live.
 *
 * /api/health/ready only proves the DB is reachable; it says nothing about
 * whether THIS process's event loop is actually free to service requests. A
 * long synchronous block (a runaway regex, a huge JSON.parse, an accidental
 * blocking call) can leave the process technically "ready" while every
 * request queues behind it. `monitorEventLoopDelay` samples real loop lag
 * continuously in the background so this route reads a rolling signal
 * instead of measuring lag inside the request path itself (which would just
 * add the very lag it's trying to observe to response time).
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';

const histogram = monitorEventLoopDelay({ resolution: 20 });
histogram.enable();

/** Loop lag at or above this is reported as "blocked", not just "alive". */
export function eventLoopBlockedThresholdMs(): number {
  return Math.max(200, Number(process.env.HEALTH_LIVE_BLOCKED_MS || 2000));
}

export interface EventLoopHealth {
  meanMs: number;
  p99Ms: number;
  maxMs: number;
  blocked: boolean;
}

function nsToMs(ns: number): number {
  if (!Number.isFinite(ns)) return 0;
  return Math.round((ns / 1e6) * 100) / 100;
}

export function getEventLoopHealth(): EventLoopHealth {
  const maxMs = nsToMs(histogram.max);
  return {
    meanMs: nsToMs(histogram.mean),
    p99Ms: nsToMs(histogram.percentile(99)),
    maxMs,
    blocked: maxMs >= eventLoopBlockedThresholdMs(),
  };
}

/** Test-only — clears accumulated samples so tests don't see cross-test lag. */
export function resetEventLoopHealthForTests(): void {
  histogram.reset();
}
