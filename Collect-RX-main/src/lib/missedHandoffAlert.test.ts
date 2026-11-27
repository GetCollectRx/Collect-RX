import { describe, expect, it } from 'vitest';
import { describeMissedHandoff } from './missedHandoffAlert';

describe('missed handoff alert text', () => {
  it('explains why the call was missed, names the carrier, and keeps the banner up for follow-up', () => {
    const none = describeMissedHandoff({ type: 'handoff.missed', data: { claimRef: 'CLM-7', carrierId: 'manulife', reason: 'no_staff_available', at: 'x' } });
    const busy = describeMissedHandoff({ type: 'handoff.missed', data: { claimRef: 'CLM-7', carrierId: 'manulife', reason: 'staff_busy', at: 'x' } });
    const failed = describeMissedHandoff({ type: 'handoff.missed', data: { claimRef: 'CLM-7', carrierId: null, reason: 'transfer_failed', at: 'x' } });
    expect(none.detail).toMatch(/marked available/iu);
    expect(none.detail).toContain('Manulife');
    expect(busy.detail).toMatch(/already on a call/iu);
    expect(failed.detail).toMatch(/did not connect/iu);
    expect(failed.detail).toContain('a carrier');
    expect(none.autoDismissMs).toBeGreaterThanOrEqual(60_000);
  });

  it('writes carrier names the way they are branded', () => {
    const rbc = describeMissedHandoff({ type: 'handoff.missed', data: { claimRef: 'c', carrierId: 'rbc_insurance', reason: 'staff_busy', at: 'x' } });
    const telus = describeMissedHandoff({ type: 'handoff.missed', data: { claimRef: 'c', carrierId: 'telus_adjudicare', reason: 'staff_busy', at: 'x' } });
    expect(rbc.detail).toContain('RBC Insurance');
    expect(telus.detail).toContain('TELUS AdjudiCare');
  });
});
