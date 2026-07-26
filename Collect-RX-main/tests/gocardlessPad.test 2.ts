import { describe, it, expect } from 'vitest';
import { decidePadTransactionUpdate } from '../src/server/gocardless/padService';
import type { GoCardlessPayment } from '../src/server/gocardless/client';

function makePayment(overrides: Partial<GoCardlessPayment>): GoCardlessPayment {
  return {
    id: 'PM123',
    amount: 29900,
    status: 'pending_submission',
    charge_date: '2026-08-01',
    links: { mandate: 'MD123', subscription: 'SB123' },
    ...overrides,
  };
}

describe('decidePadTransactionUpdate', () => {
  it('keeps access open and stamps settledAt once funds are paid out', () => {
    const decision = decidePadTransactionUpdate(makePayment({ status: 'paid_out', charge_date: '2026-08-06' }));
    expect(decision.status).toBe('approved');
    expect(decision.settledAt).toEqual(new Date('2026-08-06'));
    expect(decision.suspendPractice).toBe(false);
    expect(decision.restorePractice).toBe(true);
    expect(decision.failureReason).toBeNull();
  });

  it('flags suspension on a failed (NSF) pull', () => {
    const decision = decidePadTransactionUpdate(makePayment({ status: 'failed' }));
    expect(decision.status).toBe('declined');
    expect(decision.suspendPractice).toBe(true);
    expect(decision.restorePractice).toBe(false);
    expect(decision.failureReason).toContain('failed');
  });

  it('flags suspension on customer_approval_denied and cancelled', () => {
    for (const status of ['customer_approval_denied', 'cancelled'] as const) {
      const decision = decidePadTransactionUpdate(makePayment({ status }));
      expect(decision.status).toBe('declined');
      expect(decision.suspendPractice).toBe(true);
    }
  });

  it('flags suspension on a chargeback', () => {
    const decision = decidePadTransactionUpdate(makePayment({ status: 'charged_back' }));
    expect(decision.status).toBe('chargeback');
    expect(decision.suspendPractice).toBe(true);
  });

  it('does not touch practice access while a pull is still in flight', () => {
    for (const status of ['pending_customer_approval', 'pending_submission', 'submitted', 'confirmed'] as const) {
      const decision = decidePadTransactionUpdate(makePayment({ status }));
      expect(decision.suspendPractice).toBe(false);
      expect(decision.restorePractice).toBe(false);
    }
  });
});
