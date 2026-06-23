import { describe, expect, it } from 'vitest';
import { startupAlertEmailTo } from '../src/server/observability/startupAlerts.js';
import {
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
