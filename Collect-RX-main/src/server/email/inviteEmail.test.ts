import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { warn, send, setApiKey } = vi.hoisted(() => ({ warn: vi.fn(), send: vi.fn(), setApiKey: vi.fn() }));

vi.mock('../observability/logger.js', () => ({ logger: { warn, info: vi.fn(), error: vi.fn() } }));
vi.mock('@sendgrid/mail', () => ({ default: { send, setApiKey } }));

import { sendInviteEmail } from './inviteEmail.js';

const invite = { toEmail: 'manager@example.invalid', practiceName: 'Synthetic Dental', role: 'office_manager', token: 'live-invite-token-123' };

describe('sendInviteEmail', () => {
  const original = process.env.SENDGRID_API_KEY;
  beforeEach(() => {
    vi.clearAllMocks();
    send.mockResolvedValue(undefined);
  });
  afterEach(() => {
    if (original === undefined) delete process.env.SENDGRID_API_KEY;
    else process.env.SENDGRID_API_KEY = original;
  });

  it('says nothing was sent when no email provider is configured, and never logs the invite token', async () => {
    delete process.env.SENDGRID_API_KEY;
    await expect(sendInviteEmail(invite)).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('live-invite-token-123');
  });

  it('says it was sent when the provider accepted the message', async () => {
    process.env.SENDGRID_API_KEY = 'SG.synthetic-test-key';
    await expect(sendInviteEmail(invite)).resolves.toBe(true);
    expect(send).toHaveBeenCalledOnce();
  });

  it('lets a provider failure reach the caller so it can hand back the token', async () => {
    process.env.SENDGRID_API_KEY = 'SG.synthetic-test-key';
    send.mockRejectedValue(new Error('provider down'));
    await expect(sendInviteEmail(invite)).rejects.toThrow('provider down');
  });
});
