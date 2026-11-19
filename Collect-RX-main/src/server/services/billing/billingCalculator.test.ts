import { describe, expect, it } from 'vitest';
import { calculateOntarioSplitBilling } from './billingCalculator.js';

describe('calculateOntarioSplitBilling', () => {
  it('applies 0% co-pay and permits balance billing for private/CDCP-only claims', () => {
    const result = calculateOntarioSplitBilling({
      odaFeeAmount: 120,
      cdcpFeeAmount: 85,
      coPayTier: 0,
      isProvincialSecondary: false,
    });

    expect(result.patientCoPayCents).toBe(0);
    expect(result.cdcpApprovedCoverageCents).toBe(8500);
    expect(result.balanceBillingCents).toBe(3500);
    expect(result.totalPatientResponsibilityCents).toBe(3500);
    expect(result.secondaryRouteAmountCents).toBe(0);
  });

  it('applies the 40% co-pay tier correctly', () => {
    const result = calculateOntarioSplitBilling({
      odaFeeAmount: 100,
      cdcpFeeAmount: 100,
      coPayTier: 40,
      isProvincialSecondary: false,
    });

    expect(result.patientCoPayCents).toBe(4000);
    expect(result.cdcpApprovedCoverageCents).toBe(6000);
    expect(result.balanceBillingCents).toBe(0);
    expect(result.totalPatientResponsibilityCents).toBe(4000);
  });

  it('applies the 60% co-pay tier correctly', () => {
    const result = calculateOntarioSplitBilling({
      odaFeeAmount: 100,
      cdcpFeeAmount: 100,
      coPayTier: 60,
      isProvincialSecondary: false,
    });

    expect(result.patientCoPayCents).toBe(6000);
    expect(result.cdcpApprovedCoverageCents).toBe(4000);
  });

  it('zeroes patient responsibility and routes the full remainder to Accerta when a provincial secondary is coordinating', () => {
    const result = calculateOntarioSplitBilling({
      odaFeeAmount: 120,
      cdcpFeeAmount: 85,
      coPayTier: 40,
      isProvincialSecondary: true,
    });

    expect(result.balanceBillingCents).toBe(0);
    expect(result.totalPatientResponsibilityCents).toBe(0);
    // Regression: secondaryRouteAmountCents must include BOTH the co-pay
    // (3400 = 40% of 8500) AND the ODA/CDCP gap (3500 = 12000 - 8500) —
    // an earlier version zeroed the gap before routing it, so Accerta was
    // never billed for it and the practice silently absorbed the loss.
    expect(result.secondaryRouteAmountCents).toBe(6900);
  });

  it('still routes the ODA/CDCP gap to Accerta at the 0% co-pay tier (regression)', () => {
    // At 0% co-pay, patientCoPayCents is 0 — this is the case that exposed
    // the bug above: with no co-pay to mask it, the routed amount collapsed
    // to exactly $0 instead of the $35 balance-billing gap.
    const result = calculateOntarioSplitBilling({
      odaFeeAmount: 120,
      cdcpFeeAmount: 85,
      coPayTier: 0,
      isProvincialSecondary: true,
    });

    expect(result.patientCoPayCents).toBe(0);
    expect(result.balanceBillingCents).toBe(0);
    expect(result.totalPatientResponsibilityCents).toBe(0);
    expect(result.secondaryRouteAmountCents).toBe(3500);
  });

  it('never charges balance billing when the CDCP fee exceeds the ODA fee', () => {
    const result = calculateOntarioSplitBilling({
      odaFeeAmount: 80,
      cdcpFeeAmount: 85,
      coPayTier: 0,
      isProvincialSecondary: false,
    });

    expect(result.balanceBillingCents).toBe(0);
  });

  it('rejects an invalid co-pay tier', () => {
    expect(() =>
      calculateOntarioSplitBilling({
        odaFeeAmount: 100,
        cdcpFeeAmount: 100,
        // @ts-expect-error deliberately invalid tier
        coPayTier: 25,
        isProvincialSecondary: false,
      }),
    ).toThrow(/Invalid CDCP co-pay tier/);
  });

  it('rejects negative fee amounts', () => {
    expect(() =>
      calculateOntarioSplitBilling({
        odaFeeAmount: -10,
        cdcpFeeAmount: 85,
        coPayTier: 0,
        isProvincialSecondary: false,
      }),
    ).toThrow(/non-negative/);
  });
});
