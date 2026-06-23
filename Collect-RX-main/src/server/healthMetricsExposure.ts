import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { getMetrics } from './observability/metrics.js';

function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

function bearerToken(req: Request): string {
  const h = req.headers.authorization;
  if (!h || typeof h !== 'string') return '';
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1]?.trim() ?? '';
}

/**
 * In production, strip `deployment` (infra fingerprint) from `/api/health/metrics` unless the caller
 * presents `Authorization: Bearer <HEALTH_METRICS_TOKEN>` matching a configured non-empty token.
 */
export function buildPublicHealthMetricsBody(req: Request): { success: true; metrics: ReturnType<typeof getMetrics> } {
  const metrics = getMetrics();
  if (process.env.NODE_ENV !== 'production') {
    return { success: true, metrics };
  }
  const secret = (process.env.HEALTH_METRICS_TOKEN || '').trim();
  const token = bearerToken(req);
  if (secret && token && timingSafeStringEqual(secret, token)) {
    return { success: true, metrics };
  }
  const { deployment: _omit, ...rest } = metrics;
  return {
    success: true,
    metrics: {
      ...rest,
      deployment: {
        redacted: true as const,
        hint: 'Set HEALTH_METRICS_TOKEN and send Authorization: Bearer <token> for full deployment flags.',
      },
    } as unknown as ReturnType<typeof getMetrics>,
  };
}
