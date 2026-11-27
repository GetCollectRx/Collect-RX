import { describe, it, expect } from 'vitest';
import { callsPausedMessage } from '../src/server/plans/usagePeriodService';

describe('callsPausedMessage', () => {
  it('gives a reason and next step for every pause reason', () => {
    for (const r of ['overage_pending', 'payment_failed', 'cogs_breaker', 'other']) {
      expect(callsPausedMessage(r).length).toBeGreaterThan(30);
    }
    expect(callsPausedMessage('payment_failed')).toMatch(/payment/);
  });
});
