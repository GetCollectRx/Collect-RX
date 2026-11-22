/**
 * An invite must never be reported as "sent" when no email went out. With no
 * mail provider configured the inviter is told the email was not sent and is
 * handed the link instead; with a provider the email is sent and the token is
 * not echoed back.
 *
 * The route tests are DB-dependent and skip with a clear log if DATABASE_URL is
 * unreachable (same pattern as tests/acceptInviteFlow.test.ts).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const mailState = vi.hoisted(() => ({ configured: false }));
const sendMailMock = vi.hoisted(() => vi.fn());

vi.mock('../src/server/email/mailer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/server/email/mailer.js')>();
  return { ...actual, isEmailConfigured: () => mailState.configured, sendMail: sendMailMock };
});

import { app, prisma } from '../src/server/index.js';
import { sendInviteEmail } from '../src/server/email/inviteEmail.js';
import { logger } from '../src/server/observability/logger.js';
import { createPracticeWithOwnerForTests, cleanupPracticeWithUsers } from './factories/practice.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn(
    '[inviteEmailDelivery] DATABASE_URL unreachable — DB-dependent tests will be skipped:',
    (e as Error).message,
  );
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

beforeEach(() => {
  mailState.configured = false;
  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue({ provider: 'sendgrid' });
});

const INVITE = {
  toEmail: 'invitee@fixture.test',
  practiceName: 'Fixture Dental',
  role: 'front_desk',
  token: 'tok-secret-invite-token-1234',
} as const;

describe('sendInviteEmail', () => {
  it('resolves false and sends nothing when no mail provider is configured', async () => {
    await expect(sendInviteEmail(INVITE)).resolves.toBe(false);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('keeps the live invite token out of the log when it skips the email', async () => {
    const infoSpy = vi.spyOn(logger, 'info');
    try {
      await sendInviteEmail(INVITE);
      expect(JSON.stringify(infoSpy.mock.calls)).not.toContain(INVITE.token);
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('resolves true after handing the email to the provider', async () => {
    mailState.configured = true;
    await expect(sendInviteEmail(INVITE)).resolves.toBe(true);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock.mock.calls[0][0]).toMatchObject({ to: INVITE.toEmail });
  });

  it('still throws when the provider fails, so callers can report the failure', async () => {
    mailState.configured = true;
    sendMailMock.mockRejectedValue(new Error('provider rejected the key'));
    await expect(sendInviteEmail(INVITE)).rejects.toThrow('provider rejected the key');
  });
});

function cookieHeaderFrom(res: request.Response): string {
  const setCookie = res.headers['set-cookie'];
  return Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
}

describe.skipIf(!dbReady)('POST /api/auth/invite reports whether the email really went out', () => {
  async function inviteAsOwner(invitedEmail: string): Promise<{ res: request.Response; practiceId: string }> {
    const { practice, email, password } = await createPracticeWithOwnerForTests(prisma);
    const loginRes = await request(app).post('/api/auth/login').send({ email, password });
    expect(loginRes.status).toBe(200);
    const res = await request(app)
      .post('/api/auth/invite')
      .set('Cookie', cookieHeaderFrom(loginRes))
      .send({ email: invitedEmail, role: 'front_desk' });
    return { res, practiceId: practice.id };
  }

  it('says the email was not sent, and returns a working link, when no provider is configured', async () => {
    const invitedEmail = `invitee-${Date.now()}-a@fixture.test`;
    const { res, practiceId } = await inviteAsOwner(invitedEmail);
    try {
      expect(res.status).toBe(200);
      expect(res.body.invited).toBe(true);
      expect(res.body.emailSent).toBe(false);
      expect(typeof res.body.token).toBe('string');
      expect(sendMailMock).not.toHaveBeenCalled();

      const lookup = await request(app).get(`/api/auth/invite/${res.body.token as string}`);
      expect(lookup.status).toBe(200);
      expect(lookup.body.email).toBe(invitedEmail);
    } finally {
      await cleanupPracticeWithUsers(prisma, practiceId);
    }
  });

  it('says the email was sent, without echoing the token, when a provider delivers it', async () => {
    mailState.configured = true;
    const invitedEmail = `invitee-${Date.now()}-b@fixture.test`;
    const { res, practiceId } = await inviteAsOwner(invitedEmail);
    try {
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ invited: true, emailSent: true });
      expect(sendMailMock).toHaveBeenCalledTimes(1);
    } finally {
      await cleanupPracticeWithUsers(prisma, practiceId);
    }
  });

  it('says the email was not sent, with the link, when the provider fails', async () => {
    mailState.configured = true;
    sendMailMock.mockRejectedValue(new Error('provider outage'));
    const invitedEmail = `invitee-${Date.now()}-c@fixture.test`;
    const { res, practiceId } = await inviteAsOwner(invitedEmail);
    try {
      expect(res.status).toBe(200);
      expect(res.body.emailSent).toBe(false);
      expect(typeof res.body.token).toBe('string');
    } finally {
      await cleanupPracticeWithUsers(prisma, practiceId);
    }
  });
});
