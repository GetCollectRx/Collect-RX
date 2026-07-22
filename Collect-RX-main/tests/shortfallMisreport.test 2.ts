/**
 * Deterministic backstop: a CLAIM_PAID outcome whose stated payment is
 * materially below the expected amount must fail validation and route to
 * human review — regardless of what the voice model did on the call.
 */
import { describe, it, expect } from 'vitest';
import { detectShortfallMisreport, parseMoneyToCents } from '../src/server/vapi/claimsValidatorWebhook';

describe('parseMoneyToCents', () => {
  it('parses spoken and formatted money strings', () => {
    expect(parseMoneyToCents('410 dollars')).toBe(41000);
    expect(parseMoneyToCents('$410.00')).toBe(41000);
    expect(parseMoneyToCents('1,250.50')).toBe(125050);
    expect(parseMoneyToCents('no number here')).toBeNull();
    expect(parseMoneyToCents(undefined)).toBeNull();
    expect(parseMoneyToCents(true)).toBeNull();
  });
});

describe('detectShortfallMisreport', () => {
  const expected = 125000; // $1,250

  it('flags CLAIM_PAID when payment is materially below expected', () => {
    const v = detectShortfallMisreport('CLAIM_PAID', '410 dollars', expected);
    expect(v?.rule).toBe('SHORTFALL_MISREPORTED');
    expect(v?.severity).toBe('CRITICAL');
  });

  it('does not flag PARTIAL_PAYMENT — that is the correct label for a shortfall', () => {
    expect(detectShortfallMisreport('PARTIAL_PAYMENT', '410 dollars', expected)).toBeNull();
  });

  it('does not flag a full payment', () => {
    expect(detectShortfallMisreport('CLAIM_PAID', '$1,250.00', expected)).toBeNull();
  });

  it('tolerates variance within the $50 reconciliation threshold', () => {
    expect(detectShortfallMisreport('CLAIM_PAID', '$1,210.00', expected)).toBeNull();
    expect(detectShortfallMisreport('CLAIM_PAID', '$1,199.00', expected)?.rule).toBe('SHORTFALL_MISREPORTED');
  });

  it('is silent when expected amount or payment is unknown', () => {
    expect(detectShortfallMisreport('CLAIM_PAID', '410 dollars', null)).toBeNull();
    expect(detectShortfallMisreport('CLAIM_PAID', undefined, expected)).toBeNull();
    expect(detectShortfallMisreport('PROCESSING', '410 dollars', expected)).toBeNull();
  });
});
