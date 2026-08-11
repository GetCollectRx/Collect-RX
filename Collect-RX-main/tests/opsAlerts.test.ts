import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAlertDefinition } from '../src/server/observability/alertCatalog.js';
import {
  alertsFromFailedChecks,
  formatOpsAlertText,
  opsAlertsEnabled,
  shouldSendAlert,
} from '../src/server/observability/opsAlerts.js';

describe('opsAlerts', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('catalog entries include impact and fixes for database failures', () => {
    const def = getAlertDefinition('database');
    expect(def.severity).toBe('critical');
    expect(def.impact.length).toBeGreaterThan(0);
    expect(def.suggestedFixes.length).toBeGreaterThan(0);
    expect(def.affectedSystems).toContain('PostgreSQL');
  });

  it('formats alert text with IMPACT and FIX sections', () => {
    const text = formatOpsAlertText({
      alertId: 'readiness',
      detail: '503 from /api/health/ready',
      source: 'test',
      host: 'https://app.example.com',
    });
    expect(text).toContain('IMPACT:');
    expect(text).toContain('FIX:');
    expect(text).toContain('Database not ready');
    expect(text).toContain('https://app.example.com');
    expect(text).toContain('503');
  });

  it('maps failed diagnosis checks to alert payloads', () => {
    const payloads = alertsFromFailedChecks(
      [{ id: 'env', detail: 'JWT_SECRET missing' }],
      'diagnosis',
    );
    expect(payloads).toHaveLength(1);
    expect(payloads[0].alertId).toBe('env');
    expect(payloads[0].detail).toContain('JWT');
  });

  it('respects cooldown when OPS_ALERTS_ENABLED', () => {
    vi.stubEnv('OPS_ALERTS_ENABLED', '1');
    vi.stubEnv('OPS_ALERT_COOLDOWN_MINUTES', '60');
    const p = { alertId: 'tests', source: 'unit-test-cooldown' };
    expect(shouldSendAlert(p)).toBe(true);
  });

  describe('opsAlertsEnabled — production-default gate (P1.1)', () => {
    it('defaults on in production when the env var is unset', () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('OPS_ALERTS_ENABLED', '');
      expect(opsAlertsEnabled()).toBe(true);
    });

    it('defaults off outside production when the env var is unset', () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('OPS_ALERTS_ENABLED', '');
      expect(opsAlertsEnabled()).toBe(false);
    });

    it('an explicit "0" opts out even in production', () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('OPS_ALERTS_ENABLED', '0');
      expect(opsAlertsEnabled()).toBe(false);
    });

    it('an explicit "1" opts in outside production', () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('OPS_ALERTS_ENABLED', '1');
      expect(opsAlertsEnabled()).toBe(true);
    });
  });
});
