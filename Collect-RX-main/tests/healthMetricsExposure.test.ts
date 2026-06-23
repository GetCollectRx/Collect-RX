import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { buildPublicHealthMetricsBody } from '../src/server/healthMetricsExposure.js';

function mockReq(auth?: string): Request {
  return { headers: auth ? { authorization: auth } : {} } as Request;
}

describe('healthMetricsExposure', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('includes full deployment in non-production', () => {
    vi.stubEnv('NODE_ENV', 'test');
    const body = buildPublicHealthMetricsBody(mockReq());
    expect(body.metrics.deployment).toBeDefined();
    expect(body.metrics.deployment).not.toHaveProperty('redacted');
  });

  it('redacts deployment in production without bearer', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('HEALTH_METRICS_TOKEN', 'secret-token');
    const body = buildPublicHealthMetricsBody(mockReq());
    expect(body.metrics.deployment).toMatchObject({ redacted: true });
  });

  it('restores deployment in production with valid bearer', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('HEALTH_METRICS_TOKEN', 'secret-token');
    const body = buildPublicHealthMetricsBody(mockReq('Bearer secret-token'));
    expect(body.metrics.deployment).toBeDefined();
    expect(body.metrics.deployment).not.toHaveProperty('redacted');
  });

  it('rejects wrong bearer length without throwing', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('HEALTH_METRICS_TOKEN', 'secret-token');
    const body = buildPublicHealthMetricsBody(mockReq('Bearer wrong'));
    expect(body.metrics.deployment).toMatchObject({ redacted: true });
  });

  it('redacts when HEALTH_METRICS_TOKEN is unset in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('HEALTH_METRICS_TOKEN', '');
    const body = buildPublicHealthMetricsBody(mockReq());
    expect(body.metrics.deployment).toMatchObject({ redacted: true });
  });
});
