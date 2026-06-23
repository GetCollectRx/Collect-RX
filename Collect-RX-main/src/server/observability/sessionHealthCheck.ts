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

  const failed = checks.filter((c) => !c.ok && !c.skipped);
  return {
    ok: failed.length === 0,
    checks,
    at: new Date().toISOString(),
  };
}
