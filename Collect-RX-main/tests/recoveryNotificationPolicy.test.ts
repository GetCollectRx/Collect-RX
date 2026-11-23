import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isDemoPracticeForExternalAlerts,
  practiceGateAlertsEnabled,
  recoveryAttentionExternalAlertsEnabled,
} from '../src/server/recovery/recoveryNotifications.js';

describe('recovery notification channel policy', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not enable practice gate alerts by inheriting global ops alerting', () => {
    vi.stubEnv('OPS_ALERTS_ENABLED', '1');
    vi.stubEnv('PRACTICE_GATE_ALERTS_ENABLED', '');

    expect(practiceGateAlertsEnabled()).toBe(false);
  });

  it('requires an explicit opt-in for external recovery attention digests', () => {
    vi.stubEnv('OPS_ALERTS_ENABLED', '1');
    vi.stubEnv('RECOVERY_ATTENTION_EXTERNAL_ALERTS_ENABLED', '');

    expect(recoveryAttentionExternalAlertsEnabled()).toBe(false);
  });

  it('accepts an explicit recovery digest opt-in', () => {
    vi.stubEnv('RECOVERY_ATTENTION_EXTERNAL_ALERTS_ENABLED', 'true');

    expect(recoveryAttentionExternalAlertsEnabled()).toBe(true);
  });

  it('excludes the existing named demo practice from external alerts', () => {
    expect(
      isDemoPracticeForExternalAlerts({ name: 'CollectRx Demo Practice' }),
    ).toBe(true);
  });

  it('excludes custom-named demo seeds through their settings marker', () => {
    expect(
      isDemoPracticeForExternalAlerts({
        name: 'Prospect Walkthrough',
        settings: { demoMode: true },
      }),
    ).toBe(true);
  });

  it('does not exclude a live practice', () => {
    expect(
      isDemoPracticeForExternalAlerts({
        name: 'Ottawa Dental Centre',
        settings: { demoMode: false },
      }),
    ).toBe(false);
  });
});
