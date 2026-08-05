import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAlertDefinition } from '../src/server/observability/alertCatalog.js';
import { checkOpsAlertingConfigured } from '../src/server/observability/startupHealthScan.js';
import {
  shouldAlertOnJobExhaustion,
  buildJobFailureAlertDetail,
  resolveJobCorrelationId,
} from '../src/server/jobs/jobFailureAlert.js';

describe('new alert catalog entries', () => {
  it.each(['queue_dispatch_stalled', 'call_attempt_stuck', 'worker_job_failed', 'ops_alerting_disabled'])(
    '%s has real impact and fix text, not the unknown-issue fallback',
    (id) => {
      const def = getAlertDefinition(id);
      expect(def.title).not.toContain('Unknown issue');
      expect(def.impact.length).toBeGreaterThan(0);
      expect(def.suggestedFixes.length).toBeGreaterThan(0);
    },
  );
});

describe('checkOpsAlertingConfigured', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('passes when monitor + alerts + at least one channel are all configured', () => {
    vi.stubEnv('OPS_MONITOR_ENABLED', '1');
    vi.stubEnv('OPS_ALERTS_ENABLED', '1');
    vi.stubEnv('OPS_ALERT_WEBHOOK_URL', 'https://hooks.example.com/x');
    const result = checkOpsAlertingConfigured();
    expect(result.ok).toBe(true);
    expect(result.id).toBe('ops_alerting_disabled');
  });

  it('fails when OPS_MONITOR_ENABLED is unset even if alerts + channel are configured', () => {
    vi.stubEnv('OPS_MONITOR_ENABLED', '');
    vi.stubEnv('OPS_ALERTS_ENABLED', '1');
    vi.stubEnv('OPS_ALERT_WEBHOOK_URL', 'https://hooks.example.com/x');
    const result = checkOpsAlertingConfigured();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('OPS_MONITOR_ENABLED');
  });

  it('fails when no delivery channel is configured even if both flags are on', () => {
    vi.stubEnv('OPS_MONITOR_ENABLED', '1');
    vi.stubEnv('OPS_ALERTS_ENABLED', '1');
    vi.stubEnv('ALERT_SMS_TO', '');
    vi.stubEnv('TWILIO_ACCOUNT_SID', '');
    vi.stubEnv('TWILIO_AUTH_TOKEN', '');
    vi.stubEnv('OPS_ALERT_EMAIL_TO', '');
    vi.stubEnv('SENDGRID_API_KEY', '');
    vi.stubEnv('OPS_ALERT_WEBHOOK_URL', '');
    const result = checkOpsAlertingConfigured();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('delivery channel');
  });

  it('accepts SMS as the sole channel when Twilio creds + ALERT_SMS_TO are all present', () => {
    vi.stubEnv('OPS_MONITOR_ENABLED', '1');
    vi.stubEnv('OPS_ALERTS_ENABLED', '1');
    vi.stubEnv('ALERT_SMS_TO', '+16135551234');
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC123');
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'secret');
    vi.stubEnv('OPS_ALERT_WEBHOOK_URL', '');
    vi.stubEnv('OPS_ALERT_EMAIL_TO', '');
    vi.stubEnv('SENDGRID_API_KEY', '');
    const result = checkOpsAlertingConfigured();
    expect(result.ok).toBe(true);
  });
});

describe('BullMQ job-failure alert decision', () => {
  it('alerts once attempts made reaches attempts allowed', () => {
    expect(shouldAlertOnJobExhaustion(3, 3)).toBe(true);
    expect(shouldAlertOnJobExhaustion(4, 3)).toBe(true);
  });

  it('does not alert while retries remain', () => {
    expect(shouldAlertOnJobExhaustion(1, 3)).toBe(false);
    expect(shouldAlertOnJobExhaustion(2, 3)).toBe(false);
  });

  it('formats a detail string with job name, id, attempt count, and error', () => {
    const detail = buildJobFailureAlertDetail('RULES_TICK', 'job-42', 3, 3, 'connection refused');
    expect(detail).toContain('RULES_TICK');
    expect(detail).toContain('job-42');
    expect(detail).toContain('3/3');
    expect(detail).toContain('connection refused');
  });
});

describe('resolveJobCorrelationId', () => {
  it('reuses a correlation ID already present on job.data', () => {
    expect(resolveJobCorrelationId({ correlationId: 'from-enqueue-time' })).toBe('from-enqueue-time');
  });

  it('generates a fresh UUID when job.data has none', () => {
    const id = resolveJobCorrelationId(undefined);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('generates a fresh UUID when job.data.correlationId is blank', () => {
    const id = resolveJobCorrelationId({ correlationId: '   ' });
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('generates a different UUID on each call with no correlation ID given', () => {
    expect(resolveJobCorrelationId(undefined)).not.toBe(resolveJobCorrelationId(undefined));
  });
});
