import { describe, expect, it } from 'vitest';
import { describeHandoffAlert } from './handoffAlert';

describe('handoff alert text', () => {
  it('tells staff to pick up, with carrier and claim, and no patient detail', () => {
    const a = describeHandoffAlert({ type: 'handoff.requested', data: { claimRef: 'CLM-42', carrierId: 'sun_life', amountText: 'for $300.00', at: '2026-11-12T15:00:00Z' } });
    expect(a.kind).toBe('requested');
    expect(a.title).toMatch(/pick up the phone/iu);
    expect(a.detail).toContain('Sun Life');
    expect(a.detail).toContain('CLM-42');
    expect(a.detail).toContain('$300.00');
  });

  it('explains why a call was missed and keeps that banner longer', () => {
    const none = describeHandoffAlert({ type: 'handoff.missed', data: { claimRef: 'CLM-7', carrierId: 'manulife', reason: 'no_staff_available', at: 'x' } });
    const busy = describeHandoffAlert({ type: 'handoff.missed', data: { claimRef: 'CLM-7', carrierId: 'manulife', reason: 'staff_busy', at: 'x' } });
    const failed = describeHandoffAlert({ type: 'handoff.missed', data: { claimRef: 'CLM-7', carrierId: null, reason: 'transfer_failed', at: 'x' } });
    expect(none.detail).toMatch(/marked available/iu);
    expect(busy.detail).toMatch(/already on a call/iu);
    expect(failed.detail).toMatch(/did not connect/iu);
    expect(failed.detail).toContain('a carrier');
    expect(none.autoDismissMs).toBeGreaterThan(describeHandoffAlert({ type: 'handoff.requested', data: { claimRef: 'c', carrierId: null, amountText: '', at: 'x' } }).autoDismissMs);
  });
});
