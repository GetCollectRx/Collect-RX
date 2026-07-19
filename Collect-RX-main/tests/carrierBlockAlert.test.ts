/**
 * Integration test for CARRIER_BLOCK SMS alert
 *
 * Verifies that when a carrier block event is detected,
 * the SMS alert is sent to Twilio with the correct message payload.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { CarrierId } from '@prisma/client';
import { sendCarrierBlockAlert } from '../src/services/alerts';

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn().mockResolvedValue({ sid: 'SM123' }),
}));

vi.mock('twilio', () => ({
  default: () => ({ messages: { create: mockCreate } }),
}));

describe('Carrier Block Alert Service', () => {
  beforeEach(() => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'test_account_sid');
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'test_auth_token');
    vi.stubEnv('TWILIO_FROM_NUMBER', '+1234567890');
    vi.stubEnv('ALERT_SMS_TO', '+15551234567,+15559999999');
  });

  it('sends SMS alert when carrier block is detected', async () => {
    mockCreate.mockClear();

    const params = {
      practiceId: 'practice-xyz',
      carrierId: 'sun_life' as CarrierId,
      vapiCallId: 'call-123',
      outcomeDetail: 'Automated system detection',
    };

    await sendCarrierBlockAlert(params);

    // Verify Twilio client was called
    expect(mockCreate).toHaveBeenCalled();
    expect(mockCreate.mock.calls.length).toBeGreaterThanOrEqual(1);

    // Check message contents
    const firstCall = mockCreate.mock.calls[0]?.[0];
    expect(firstCall?.body).toContain('CARRIER BLOCK DETECTED');
    expect(firstCall?.body).toContain('Sun Life Financial');
    expect(firstCall?.body).toContain('practice-xyz');
    expect(firstCall?.body).toContain('call-123');
  });

  it('handles missing Twilio env vars gracefully', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', '');
    vi.stubEnv('TWILIO_AUTH_TOKEN', '');
    vi.stubEnv('TWILIO_FROM_NUMBER', '');
    vi.stubEnv('ALERT_SMS_TO', '');

    const params = {
      practiceId: 'practice-abc',
      carrierId: 'manulife' as CarrierId,
      vapiCallId: 'call-456',
      outcomeDetail: 'Automated detection',
    };

    // Should not throw even with missing credentials
    await expect(sendCarrierBlockAlert(params)).resolves.not.toThrow();
  });
});
