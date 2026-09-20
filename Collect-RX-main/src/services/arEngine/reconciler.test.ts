import { describe, expect, it } from 'vitest';
import { reconcileAgingAgainstCalls, type AgingReportRow, type ResolvedCallSignal } from './reconciler.js';

function agingRow(overrides: Partial<AgingReportRow>): AgingReportRow {
  return {
    claimNumber: 'CLM-1',
    carrierId: 'sun_life',
    outstandingCents: 10000,
    asOfDate: new Date('2026-08-01'),
    ...overrides,
  };
}

function callSignal(overrides: Partial<ResolvedCallSignal>): ResolvedCallSignal {
  return {
    claimNumber: 'CLM-1',
    carrierId: 'sun_life',
    outcome: 'RESOLVED',
    durationSeconds: 300,
    holdSeconds: null,
    resolvedAmountCents: 10000,
    occurredAt: new Date('2026-08-02'),
    ...overrides,
  };
}

describe('reconcileAgingAgainstCalls', () => {
  it('flags an aging claim with no recorded call activity', () => {
    const report = reconcileAgingAgainstCalls([agingRow({})], []);
    expect(report.discrepancies).toEqual([
      expect.objectContaining({ claimNumber: 'CLM-1', kind: 'NO_CALL_ACTIVITY' }),
    ]);
    expect(report.totalDollarsResolvedCents).toBe(0);
  });

  it('counts dollars resolved when the call is RESOLVED and aging confirms the balance cleared', () => {
    const report = reconcileAgingAgainstCalls(
      [agingRow({ outstandingCents: 0 })],
      [callSignal({ resolvedAmountCents: 15000 })],
    );
    expect(report.totalDollarsResolvedCents).toBe(15000);
    expect(report.discrepancies).toEqual([]);
  });

  it('flags a claim resolved by call but still outstanding per aging (sync lag)', () => {
    const report = reconcileAgingAgainstCalls(
      [agingRow({ outstandingCents: 5000 })],
      [callSignal({ resolvedAmountCents: 5000 })],
    );
    expect(report.discrepancies).toEqual([
      expect.objectContaining({ claimNumber: 'CLM-1', kind: 'UNRESOLVED_IN_AGING_AFTER_CALL_RESOLVED' }),
    ]);
    expect(report.totalDollarsResolvedCents).toBe(0);
  });

  it('adds an amount mismatch when the carrier-confirmed figure disagrees with the aging balance', () => {
    const report = reconcileAgingAgainstCalls(
      [agingRow({ outstandingCents: 5000 })],
      [callSignal({ resolvedAmountCents: 8000 })],
    );
    const kinds = report.discrepancies.map((d) => d.kind);
    expect(kinds).toContain('UNRESOLVED_IN_AGING_AFTER_CALL_RESOLVED');
    expect(kinds).toContain('AMOUNT_MISMATCH');
  });

  it('does not reconcile a claim whose latest call outcome is not RESOLVED', () => {
    const report = reconcileAgingAgainstCalls(
      [agingRow({ outstandingCents: 5000 })],
      [callSignal({ outcome: 'PENDING', resolvedAmountCents: null })],
    );
    expect(report.discrepancies).toEqual([]);
    expect(report.totalDollarsResolvedCents).toBe(0);
  });

  it('uses only the latest signal per claim when multiple attempts exist', () => {
    const report = reconcileAgingAgainstCalls(
      [agingRow({ outstandingCents: 0 })],
      [
        callSignal({ outcome: 'FAILED', occurredAt: new Date('2026-08-01'), resolvedAmountCents: null }),
        callSignal({ outcome: 'RESOLVED', occurredAt: new Date('2026-08-03'), resolvedAmountCents: 10000 }),
      ],
    );
    expect(report.totalDollarsResolvedCents).toBe(10000);
  });

  it('computes call success rate across all attempts, not just aging-matched ones', () => {
    const report = reconcileAgingAgainstCalls(
      [],
      [
        callSignal({ outcome: 'RESOLVED' }),
        callSignal({ outcome: 'FAILED', resolvedAmountCents: null }),
        callSignal({ outcome: 'NO_ANSWER', resolvedAmountCents: null }),
        callSignal({ outcome: 'DENIED', resolvedAmountCents: null }),
      ],
    );
    expect(report.callSuccessRate).toBe(0.25);
    expect(report.totalCallAttempts).toBe(4);
  });

  it('averages hold seconds across attempts that recorded one, ignoring nulls', () => {
    const report = reconcileAgingAgainstCalls(
      [],
      [
        callSignal({ holdSeconds: 100 }),
        callSignal({ holdSeconds: 200 }),
        callSignal({ holdSeconds: null }),
      ],
    );
    expect(report.averageHoldSeconds).toBe(150);
  });

  it('reports null average hold seconds when no attempt recorded a hold', () => {
    const report = reconcileAgingAgainstCalls([], [callSignal({ holdSeconds: null })]);
    expect(report.averageHoldSeconds).toBeNull();
  });
});
