/**
 * In-call deterministic payment comparison tool. The model copies amounts;
 * the server does the math and returns the exact next move as a tool result.
 */
import { describe, it, expect } from 'vitest';
import { verifyPaymentToolResult } from '../src/server/vapi/vapiWebhook';

describe('verifyPaymentToolResult', () => {
  it('directs the shortfall challenge when payment is materially short', () => {
    const r = verifyPaymentToolResult('410 dollars', '$1,250.00');
    expect(r).toContain('SHORTFALL DETECTED');
    expect(r).toContain('$840.00');
    expect(r).toContain('PARTIAL_PAYMENT');
    expect(r).toContain('reduction or remark codes');
  });

  it('confirms a full payment and directs normal capture', () => {
    const r = verifyPaymentToolResult('$1,250.00', '$1,250.00');
    expect(r).toContain('AMOUNT OK');
    expect(r).toContain('CLAIM_PAID');
  });

  it('tolerates variance within $50', () => {
    expect(verifyPaymentToolResult('$1,210.00', '$1,250.00')).toContain('AMOUNT OK');
    expect(verifyPaymentToolResult('$1,199.00', '$1,250.00')).toContain('SHORTFALL DETECTED');
  });

  it('asks for a digit-by-digit re-read when an amount is unparseable', () => {
    expect(verifyPaymentToolResult('some money', '$1,250.00')).toContain('AMOUNT UNCLEAR');
    expect(verifyPaymentToolResult(undefined, '$1,250.00')).toContain('AMOUNT UNCLEAR');
  });

  it('handles spoken-form amounts', () => {
    expect(verifyPaymentToolResult('410 dollars', '1250 dollars')).toContain('SHORTFALL DETECTED');
  });
});
