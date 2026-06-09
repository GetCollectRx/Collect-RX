import { describe, it, expect } from 'vitest';
import { callOutcomeToUsageCode } from '../src/server/plans/outcomeToUsageCode';
import { computeUsageAlerts } from '../src/server/plans/planBridge';

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
  const baseSummary = {
    practiceId: 'p1',
    tier: 'professional' as const,
    status: 'active' as const,
    autonomy: 'negotiation',
    abeldentSync: 'deep',
    valueMetric: 'resolved_claim',
    trial: {
      active: false,
      recoveredCents: 0,
      thresholdCents: 250000,
      progress: 0,
      startedAt: null,
      convertedAt: null,
    },
    cycle: {
      startedAt: new Date().toISOString(),
      statusCallsUsed: 0,
      statusCallsIncluded: null,
      resolvedClaimsUsed: 165,
      resolvedClaimsIncluded: 200,
    },
    lifetime: { recoveredCents: 0 },
    features: {
      label: 'Pro',
      includedStatusCallsPerCycle: null,
      includedResolvedClaimsPerCycle: 200,
      allowOverage: true,
      overageCentsPerClaim: 2200,
      usageUnitLabel: 'claims resolved',
      valueMetric: 'resolved_claim',
    },
  };

  it('emits info alert at 80% of resolved claims pool', () => {
    const alerts = computeUsageAlerts(baseSummary);
    expect(alerts.some((a) => a.code === 'resolved_claims_80')).toBe(true);
  });

  it('emits critical alert when trial limit reached', () => {
    const alerts = computeUsageAlerts({
      ...baseSummary,
      status: 'trial',
      trial: { ...baseSummary.trial, active: true, progress: 1, recoveredCents: 250000, thresholdCents: 250000 },
    });
    expect(alerts.some((a) => a.code === 'TRIAL_LIMIT_REACHED')).toBe(true);
  });
});
