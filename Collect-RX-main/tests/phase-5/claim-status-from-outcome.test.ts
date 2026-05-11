import { describe, expect, it } from 'vitest';
import { claimStatusFromCallOutcome } from '../../src/server/claimStatusFromCallOutcome';

describe('claimStatusFromCallOutcome', () => {
  it('maps RESOLVED + approved language with balance to APPROVED_PENDING_PAYMENT', () => {
    expect(
      claimStatusFromCallOutcome('RESOLVED', 'Claim approved. Carrier is processing payment.', 50_000),
    ).toBe('APPROVED_PENDING_PAYMENT');
  });

  it('maps RESOLVED + explicit payment issued to RESOLVED', () => {
    expect(
      claimStatusFromCallOutcome('RESOLVED', 'Payment has been issued via EFT.', 12_000),
    ).toBe('RESOLVED');
  });

  it('maps DENIED to DENIED', () => {
    expect(claimStatusFromCallOutcome('DENIED', 'Claim denied — not covered', 10_000)).toBe('DENIED');
  });
});
