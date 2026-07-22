import { describe, expect, it } from 'vitest';
import { shouldRevokePhiAfterCall } from '../src/server/vapi/vapiWebhook.js';

describe('shouldRevokePhiAfterCall', () => {
  it('retains PHI when the claim will be dialed again (retryable outcome)', () => {
    expect(
      shouldRevokePhiAfterCall({ route: 'CALL_CARRIER', queueStatus: 'PENDING', stopCalling: false }),
    ).toBe(false);
  });

  it('revokes PHI on a resolved/terminal outcome (no requeue)', () => {
    expect(
      shouldRevokePhiAfterCall({ route: 'STOP', queueStatus: 'COMPLETED', stopCalling: true }),
    ).toBe(true);
  });

  it('revokes PHI when calling is explicitly stopped even if route is CALL_CARRIER', () => {
    expect(
      shouldRevokePhiAfterCall({ route: 'CALL_CARRIER', queueStatus: 'PENDING', stopCalling: true }),
    ).toBe(true);
  });

  it('revokes PHI when the claim is escalated to a human', () => {
    expect(
      shouldRevokePhiAfterCall({ route: 'CALL_CARRIER', queueStatus: 'ESCALATED', stopCalling: false }),
    ).toBe(true);
  });

  it('revokes PHI when the claim is parked for a non-carrier recovery route', () => {
    expect(
      shouldRevokePhiAfterCall({ route: 'PRACTICE_GATE', queueStatus: 'PENDING', stopCalling: false }),
    ).toBe(true);
  });
});
