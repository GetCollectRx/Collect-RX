import { describe, it, expect } from 'vitest';
import { buildCoverageReport } from '../src/server/reports/coverageReport';
import { buildValueReport } from '../src/server/reports/valueReport';

describe('coverage report', () => {
  it('splits supported and unsupported AR', () => {
    const r = buildCoverageReport([
      { carrierName: 'Sun Life', outstandingAmount: 100 },
      { carrierName: 'Sun Life Financial', outstandingAmount: 50 },
      { carrierName: 'Acme Mutual', outstandingAmount: 350 },
      { carrierName: '', outstandingAmount: 0 },
    ]);
    expect(r.totalClaims).toBe(4);
    expect(r.supportedClaims).toBe(2);
    expect(r.supportedShareByAmount).toBeCloseTo(0.3);
    expect(r.unsupported[0].name).toBe('Acme Mutual');
    expect(r.unsupported.some((u) => u.name === '(blank)')).toBe(true);
  });
  it('handles empty input', () => {
    expect(buildCoverageReport([]).supportedShareByCount).toBe(0);
  });
});

describe('value report', () => {
  const a = (o: object) => ({ isHumanAssisted: true, staffHandoffAt: new Date(), durationSeconds: 600, outcome: 'RESOLVED', outcomeDetail: 'ok', claimId: 'c1', ...o });
  it('counts only handed-off calls toward hold minutes', () => {
    const r = buildValueReport([a({}), a({ claimId: 'c2', outcomeDetail: 'Handed to practice staff; no call log was received, so the outcome needs staff review.' }), a({ staffHandoffAt: null, claimId: 'c3' })]);
    expect(r).toMatchObject({ attempts: 3, handoffs: 2, holdMinutesSaved: 20, claimsTouched: 3, logsReceived: 1, needsReview: 1 });
  });
});
