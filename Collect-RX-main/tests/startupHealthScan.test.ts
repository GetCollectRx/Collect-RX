import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { startupAlertEmailTo } from '../src/server/observability/startupAlerts.js';
import {
  checkMigrationDrift,
  failedStartupChecks,
  formatStartupDigest,
} from '../src/server/observability/startupHealthScan.js';

describe('startupHealthScan', () => {
  it('formatStartupDigest includes impact and fix sections', () => {
    const { subject, text, html } = formatStartupDigest(
      [{ id: 'readiness', label: 'API readiness', ok: false, detail: '503' }],
      { host: 'https://app.test', source: 'test' },
    );
    expect(subject).toContain('1 issue');
    expect(text).toContain('Impact:');
    expect(text).toContain('Fix:');
    expect(html).toContain('Database not ready');
  });

  it('failedStartupChecks excludes passing rows', () => {
    const failed = failedStartupChecks([
      { id: 'liveness', label: 'ok', ok: true },
      { id: 'readiness', label: 'bad', ok: false },
    ]);
    expect(failed).toHaveLength(1);
    expect(failed[0].id).toBe('readiness');
  });
});

describe('checkMigrationDrift', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collectrx-migrations-'));
  mkdirSync(join(dir, '20260101000000_first'));
  mkdirSync(join(dir, '20260102000000_second'));

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function prismaWithApplied(applied: string[]): PrismaClient {
    return {
      $queryRaw: async () => applied.map((migration_name) => ({ migration_name })),
    } as unknown as PrismaClient;
  }

  it('passes when every bundled migration is applied', async () => {
    const result = await checkMigrationDrift(
      prismaWithApplied(['20260101000000_first', '20260102000000_second']),
      dir,
    );
    expect(result.ok).toBe(true);
    expect(result.id).toBe('migration_drift');
  });

  it('fails and names the missing migrations when the DB is behind', async () => {
    const result = await checkMigrationDrift(prismaWithApplied(['20260101000000_first']), dir);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('20260102000000_second');
  });

  it('fails when the migrations table cannot be read', async () => {
    const prisma = {
      $queryRaw: async () => {
        throw new Error('relation "_prisma_migrations" does not exist');
      },
    } as unknown as PrismaClient;
    const result = await checkMigrationDrift(prisma, dir);
    expect(result.ok).toBe(false);
  });

  it('skips when no migrations directory is bundled', async () => {
    const result = await checkMigrationDrift(
      prismaWithApplied([]),
      join(dir, 'does-not-exist'),
    );
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
  });
});

describe('startupAlerts', () => {
  it('defaults startup email to khalid@collectrx.ca', () => {
    const prev = process.env.STARTUP_ALERT_EMAIL_TO;
    const prevOps = process.env.OPS_ALERT_EMAIL_TO;
    delete process.env.STARTUP_ALERT_EMAIL_TO;
    delete process.env.OPS_ALERT_EMAIL_TO;
    expect(startupAlertEmailTo()).toBe('khalid@collectrx.ca');
    process.env.STARTUP_ALERT_EMAIL_TO = prev;
    process.env.OPS_ALERT_EMAIL_TO = prevOps;
  });
});
