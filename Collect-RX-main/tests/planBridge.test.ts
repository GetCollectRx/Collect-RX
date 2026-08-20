import { describe, it, expect } from 'vitest';
import { callOutcomeToUsageCode } from '../src/server/plans/outcomeToUsageCode';
import { computeUsageAlerts, gateBlockMessage, type PlanSummary } from '../src/server/plans/planBridge';

describe('callOutcomeToUsageCode', () => {
  it('maps RESOLVED claim status to paid', () => {
    expect(callOutcomeToUsageCode('RESOLVED', 'RESOLVED', 'Payment issued')).toBe('paid');
  });

  it('maps DENIED to not_covered', () => {
    expect(callOutcomeToUsageCode('DENIED', 'DENIED', 'Procedure not covered')).toBe('not_covered');
  });

  it('maps PENDING call outcome to null (not billable)', () => {
    expect(callOutcomeToUsageCode('PENDING', 'IN_QUEUE', 'Still processing')).toBeNull();
  });

  it('returns null for non-value outcomes', () => {
    expect(callOutcomeToUsageCode('NO_ANSWER', 'IN_QUEUE', '')).toBeNull();
    expect(callOutcomeToUsageCode('FAILED', 'IN_QUEUE', '')).toBeNull();
  });
});

describe('computeUsageAlerts', () => {
  const baseSummary: PlanSummary = {
    practiceId: 'p1',
    tier: 'core',
    tierName: 'Core',
    status: 'active',
    callsPaused: false,
    callsPausedReason: null,
    cycle: {
      startedAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
      minutesConsumed: 400,
      minutesIncluded: 800,
      minutesRemaining: 400,
      usagePercent: 0.5,
      callsCompleted: 10,
      dailyMinutesConsumed: 20,
      dailyCapMinutes: 100,
    },
    trial: { active: false, endsAt: null, daysRemaining: null },
    overage: { ratePerMinute: 0.25, confirmed: false },
    lifetime: { recoveredCents: 0 },
    alerts: [],
    cycleEndsAt: null,
  };

  it('emits a warning at 80% of included minutes', () => {
    const alerts = computeUsageAlerts({
      ...baseSummary,
      cycle: { ...baseSummary.cycle, minutesConsumed: 650, usagePercent: 650 / 800 },
    });
    expect(alerts.some((a) => a.code === 'usage_80')).toBe(true);
  });

  it('emits a critical usage_100 alert when overage is pending', () => {
    const alerts = computeUsageAlerts({
      ...baseSummary,
      callsPaused: true,
      callsPausedReason: 'overage_pending',
      cycle: { ...baseSummary.cycle, minutesConsumed: 800, usagePercent: 1 },
    });
    const alert = alerts.find((a) => a.code === 'usage_100');
    expect(alert?.level).toBe('critical');
  });

  it('emits a critical TRIAL_LIMIT_REACHED alert when the trial is used up', () => {
    const alerts = computeUsageAlerts({
      ...baseSummary,
      trial: { active: true, endsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(), daysRemaining: 5 },
      cycle: { ...baseSummary.cycle, minutesIncluded: 500, minutesConsumed: 500, usagePercent: 1 },
    });
    expect(alerts.some((a) => a.code === 'TRIAL_LIMIT_REACHED')).toBe(true);
  });

  it('emits a warning when the trial is ending soon', () => {
    const alerts = computeUsageAlerts({
      ...baseSummary,
      trial: { active: true, endsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(), daysRemaining: 2 },
      cycle: { ...baseSummary.cycle, minutesIncluded: 500, minutesConsumed: 100, usagePercent: 0.2 },
    });
    expect(alerts.some((a) => a.code === 'trial_ending')).toBe(true);
  });

  it('emits a critical alert when the subscription is canceled', () => {
    const alerts = computeUsageAlerts({
      ...baseSummary,
      callsPaused: true,
      callsPausedReason: 'subscription_cancelled',
    });
    expect(alerts.some((a) => a.code === 'subscription_cancelled' && a.level === 'critical')).toBe(true);
  });

  it('emits a critical alert when payment has failed', () => {
    const alerts = computeUsageAlerts({
      ...baseSummary,
      callsPaused: true,
      callsPausedReason: 'payment_failed',
    });
    expect(alerts.some((a) => a.code === 'payment_failed' && a.level === 'critical')).toBe(true);
  });

  it('emits an info alert when the billing period reset is imminent and usage is high', () => {
    const alerts = computeUsageAlerts({
      ...baseSummary,
      cycle: {
        ...baseSummary.cycle,
        minutesConsumed: 500,
        usagePercent: 500 / 800,
        endsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });
    expect(alerts.some((a) => a.code === 'reset_approaching')).toBe(true);
  });

  it('emits no alerts for healthy low usage', () => {
    const alerts = computeUsageAlerts({
      ...baseSummary,
      cycle: { ...baseSummary.cycle, minutesConsumed: 50, usagePercent: 50 / 800 },
    });
    expect(alerts).toHaveLength(0);
  });
});

describe('gateBlockMessage', () => {
  it('COGS_BREAKER_PAUSED explains the actual trigger (hold time driving cost, not the minute count) rather than a generic "usage exceeded" line', () => {
    const message = gateBlockMessage('COGS_BREAKER_PAUSED');
    // The old copy ("usage far exceeded your plan") reads as a minutes
    // problem, but this can fire while the visible monthly allowance is
    // nowhere near exhausted — the message must say so explicitly or a
    // practice checking their own dashboard sees a contradiction.
    expect(message).toMatch(/hold times/i);
    expect(message).toMatch(/allowance isn't exhausted/i);
    expect(message).not.toMatch(/usage far exceeded/i);
  });

  it('OVERAGE_PENDING still includes the overage rate when provided', () => {
    const message = gateBlockMessage('OVERAGE_PENDING', 0.25);
    expect(message).toMatch(/\$0\.25\/min/);
  });
});
