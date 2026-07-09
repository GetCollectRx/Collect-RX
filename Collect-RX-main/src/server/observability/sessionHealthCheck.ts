/**
 * Session health check — runs on every successful login and session restore.
 * Validates runtime dependencies (DB, schema, optional analytics) without re-checking static env config.
 */
import type { PrismaClient } from '@prisma/client';
import { isClickHouseMockMode, pingClickHouse } from '../productAnalytics/clickhouse.js';
import type { SessionHealthPayload } from '../../types/sessionHealth.js';
import type { StartupCheckResult } from './startupHealthScan.js';

export type { SessionHealthPayload };

const CRITICAL_TABLES = ['insurance_claims', 'call_attempts', 'emr_sync_outbox'] as const;

async function pingRedisIfConfigured(): Promise<{ configured: boolean; ok: boolean; detail: string }> {
  const url = (process.env.REDIS_URL || '').trim();
  if (!url) {
    return { configured: false, ok: true, detail: 'not configured (in-process limits only)' };
  }
  try {
    const { default: IORedis } = await import('ioredis');
    const client = new IORedis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true,
    });
    await client.connect();
    const pong = await client.ping();
    await client.quit();
    return { configured: true, ok: pong === 'PONG', detail: pong === 'PONG' ? 'PING ok' : `unexpected: ${pong}` };
  } catch (err) {
    return { configured: true, ok: false, detail: (err as Error).message };
  }
}

function integrationConfigured(keys: string[]): boolean {
  return keys.some((k) => Boolean((process.env[k] || '').trim()));
}

export async function runSessionHealthCheck(prisma: PrismaClient): Promise<SessionHealthPayload> {
  const checks: StartupCheckResult[] = [];

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.push({
      id: 'database_readiness',
      label: 'Database connection',
      ok: true,
      detail: 'SELECT 1 ok',
    });
  } catch (err) {
    checks.push({
      id: 'database_readiness',
      label: 'Database connection',
      ok: false,
      detail: (err as Error).message,
    });
  }

  try {
    const rows = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `;
    const have = new Set(rows.map((r) => r.tablename));
    const missing = CRITICAL_TABLES.filter((t) => !have.has(t));
    checks.push({
      id: 'database',
      label: 'Critical database tables',
      ok: missing.length === 0,
      detail: missing.length ? `missing: ${missing.join(', ')}` : 'present',
    });
  } catch (err) {
    checks.push({
      id: 'database',
      label: 'Critical database tables',
      ok: false,
      detail: (err as Error).message,
    });
  }

  if (isClickHouseMockMode()) {
    checks.push({
      id: 'analytics',
      label: 'Product analytics (ClickHouse)',
      ok: true,
      skipped: true,
      detail: 'mock mode — optional',
    });
  } else {
    const chOk = await pingClickHouse();
    checks.push({
      id: 'analytics',
      label: 'Product analytics (ClickHouse)',
      ok: chOk,
      detail: chOk ? 'connected' : 'unavailable',
    });
  }

  const redis = await pingRedisIfConfigured();
  checks.push({
    id: 'redis',
    label: 'Redis (job queue)',
    ok: redis.ok,
    skipped: !redis.configured,
    detail: redis.detail,
  });

  const integrationDefs: { id: string; label: string; keys: string[] }[] = [
    { id: 'stripe', label: 'Stripe billing', keys: ['STRIPE_SECRET_KEY'] },
    { id: 'vapi', label: 'Vapi voice', keys: ['VAPI_API_KEY'] },
    { id: 'sendgrid', label: 'SendGrid email', keys: ['SENDGRID_API_KEY'] },
  ];
  for (const integ of integrationDefs) {
    const configured = integrationConfigured(integ.keys);
    checks.push({
      id: integ.id,
      label: integ.label,
      ok: configured,
      skipped: !configured,
      detail: configured ? 'credentials configured' : 'not configured',
    });
  }

  const failed = checks.filter((c) => !c.ok && !c.skipped);
  return {
    ok: failed.length === 0,
    checks,
    at: new Date().toISOString(),
  };
}
