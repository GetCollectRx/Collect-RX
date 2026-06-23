import { describe, expect, it } from 'vitest';
import { failedStartupChecks } from '../src/server/observability/startupHealthScan.js';

describe('sessionHealthCheck', () => {
  it('failedStartupChecks excludes skipped rows', () => {
    const failed = failedStartupChecks([
      { id: 'analytics', label: 'ClickHouse', ok: true, skipped: true },
      { id: 'database', label: 'Tables', ok: false },
    ]);
    expect(failed).toHaveLength(1);
    expect(failed[0].id).toBe('database');
  });
});
