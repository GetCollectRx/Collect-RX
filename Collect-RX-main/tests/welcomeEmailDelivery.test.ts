/**
 * Signup must never silently skip the welcome email without anyone knowing,
 * and a delivery failure must never fail the signup itself — the account is
 * already created and the owner is already signed in by the time the email
 * is attempted.
 *
 * The route test is DB-dependent and skips with a clear log if DATABASE_URL
 * is unreachable (same pattern as tests/inviteEmailDelivery.test.ts).
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
import { sendWelcomeEmail } from '../src/server/email/welcomeEmail.js';
import { CURRENT_AGREEMENTS } from '../src/server/agreements/agreementRegistry.js';

const acceptedAgreements = CURRENT_AGREEMENTS.map((a) => ({ kind: a.kind, version: a.version }));

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn(
    '[welcomeEmailDelivery] DATABASE_URL unreachable — DB-dependent tests will be skipped:',
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

const WELCOME = {
  toEmail: 'owner@fixture.test',
  displayName: 'Fixture Owner',
  practiceName: 'Fixture Dental',
} as const;

describe('sendWelcomeEmail', () => {
  it('resolves false and sends nothing when no mail provider is configured', async () => {
    await expect(sendWelcomeEmail(WELCOME)).resolves.toBe(false);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('resolves true after handing the email to the provider', async () => {
    mailState.configured = true;
    await expect(sendWelcomeEmail(WELCOME)).resolves.toBe(true);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock.mock.calls[0][0]).toMatchObject({ to: WELCOME.toEmail });
  });

  it('still throws when the provider fails, so the caller can log it', async () => {
    mailState.configured = true;
    sendMailMock.mockRejectedValue(new Error('provider rejected the key'));
    await expect(sendWelcomeEmail(WELCOME)).rejects.toThrow('provider rejected the key');
  });

  it('escapes HTML in the display name and practice name', async () => {
    mailState.configured = true;
    await sendWelcomeEmail({
      toEmail: WELCOME.toEmail,
      displayName: '<script>alert(1)</script>',
      practiceName: 'A & B "Dental" <Co>',
    });
    const html = sendMailMock.mock.calls[0][0].html as string;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A &amp; B &quot;Dental&quot; &lt;Co&gt;');
  });
});

describe.skipIf(!dbReady)('POST /api/auth/register sends the welcome email without failing signup', () => {
  async function registerFixturePractice(email: string) {
    return request(app)
      .post('/api/auth/register')
      .send({
        practiceName: 'Fixture Welcome Dental',
        displayName: 'Fixture Owner',
        email,
        password: 'correct horse battery staple',
        acceptedAgreements,
      });
  }

  async function cleanup(practiceId: string | undefined) {
    if (!practiceId) return;
    await prisma.agreementAcceptance.deleteMany({ where: { practiceId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { practiceId } }).catch(() => undefined);
    await prisma.practice.delete({ where: { id: practiceId } }).catch(() => undefined);
  }

  it('still returns 201 and signs the owner in when no provider is configured', async () => {
    const email = `welcome-${Date.now()}-a@fixture.test`;
    const res = await registerFixturePractice(email);
    try {
      expect(res.status).toBe(201);
      expect(sendMailMock).not.toHaveBeenCalled();
    } finally {
      await cleanup(res.body?.practiceId as string | undefined);
    }
  });

  it('sends the welcome email when a provider is configured', async () => {
    mailState.configured = true;
    const email = `welcome-${Date.now()}-b@fixture.test`;
    const res = await registerFixturePractice(email);
    try {
      expect(res.status).toBe(201);
      expect(sendMailMock).toHaveBeenCalledTimes(1);
      expect(sendMailMock.mock.calls[0][0]).toMatchObject({ to: email });
    } finally {
      await cleanup(res.body?.practiceId as string | undefined);
    }
  });

  it('still returns 201 when the provider throws — a delivery failure must not fail signup', async () => {
    mailState.configured = true;
    sendMailMock.mockRejectedValue(new Error('provider outage'));
    const email = `welcome-${Date.now()}-c@fixture.test`;
    const res = await registerFixturePractice(email);
    try {
      expect(res.status).toBe(201);
    } finally {
      await cleanup(res.body?.practiceId as string | undefined);
    }
  });
});
