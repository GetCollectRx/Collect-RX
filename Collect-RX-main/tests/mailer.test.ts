import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EmailSendError,
  checkEmailProvider,
  getEmailProvider,
  resolveFrom,
  sendMail,
} from '../src/server/email/mailer.js';

type Env = NodeJS.ProcessEnv;
const resendEnv: Env = { RESEND_API_KEY: 're_test_key' };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getEmailProvider', () => {
  it('returns null with no keys', () => {
    expect(getEmailProvider({})).toBeNull();
  });
  it('prefers Resend when both keys exist', () => {
    expect(getEmailProvider({ RESEND_API_KEY: 'a', SENDGRID_API_KEY: 'b' })).toBe('resend');
  });
  it('uses SendGrid when only its key exists', () => {
    expect(getEmailProvider({ SENDGRID_API_KEY: 'b' })).toBe('sendgrid');
  });
  it('honours EMAIL_PROVIDER only when that provider has a key', () => {
    expect(getEmailProvider({ EMAIL_PROVIDER: 'sendgrid', RESEND_API_KEY: 'a', SENDGRID_API_KEY: 'b' })).toBe('sendgrid');
    expect(getEmailProvider({ EMAIL_PROVIDER: 'sendgrid', RESEND_API_KEY: 'a' })).toBeNull();
  });
  it('ignores blank keys', () => {
    expect(getEmailProvider({ RESEND_API_KEY: '   ' })).toBeNull();
  });
});

describe('resolveFrom', () => {
  it('prefers EMAIL_FROM_*, then SENDGRID_FROM_*, then the fallback', () => {
    expect(resolveFrom('fb@x.ca', 'FB', {})).toEqual({ email: 'fb@x.ca', name: 'FB' });
    expect(resolveFrom('fb@x.ca', 'FB', { SENDGRID_FROM_EMAIL: 'sg@x.ca', SENDGRID_FROM_NAME: 'SG' })).toEqual({
      email: 'sg@x.ca',
      name: 'SG',
    });
    expect(
      resolveFrom('fb@x.ca', 'FB', { EMAIL_FROM_ADDRESS: 'new@x.ca', SENDGRID_FROM_EMAIL: 'sg@x.ca' }),
    ).toEqual({ email: 'new@x.ca', name: 'FB' });
  });
});

describe('sendMail via Resend', () => {
  it('posts the documented body with bearer auth and a User-Agent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'abc-123' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await sendMail(
      {
        to: 'owner@clinic.ca',
        from: { email: 'noreply@collectrx.ca', name: 'CollectRx' },
        subject: 'Reset',
        text: 'hi',
        html: '<p>hi</p>',
      },
      resendEnv,
    );
    expect(result).toEqual({ provider: 'resend', id: 'abc-123' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer re_test_key');
    expect(headers['User-Agent']).toBeTruthy();
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      from: 'CollectRx <noreply@collectrx.ca>',
      to: ['owner@clinic.ca'],
      subject: 'Reset',
      text: 'hi',
      html: '<p>hi</p>',
    });
  });

  it('strips characters that could break the From header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'x' }));
    vi.stubGlobal('fetch', fetchMock);
    await sendMail(
      { to: 'a@b.ca', from: { email: 'noreply@collectrx.ca', name: 'Evil"\r\n<x>' }, subject: 's', text: 't' },
      resendEnv,
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.from).toBe('Evilx <noreply@collectrx.ca>');
  });

  it('throws EmailSendError with status and code, without leaking recipients or the key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(403, { name: 'validation_error', message: 'The collectrx.ca domain is not verified.' }),
      ),
    );
    const err = await sendMail(
      { to: 'patientless@clinic.ca', from: { email: 'noreply@collectrx.ca' }, subject: 's', text: 't' },
      resendEnv,
    ).catch((e) => e);
    expect(err).toBeInstanceOf(EmailSendError);
    expect(err.provider).toBe('resend');
    expect(err.status).toBe(403);
    expect(err.code).toBe('validation_error');
    expect(String(err.message)).not.toContain('clinic.ca');
    expect(String(err.message)).not.toContain('re_test_key');
  });

  it('splits more than 50 recipients into batches', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);
    const to = Array.from({ length: 120 }, (_, i) => `u${i}@clinic.ca`);
    await sendMail({ to, from: { email: 'noreply@collectrx.ca' }, subject: 's', text: 't' }, resendEnv);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const sizes = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string).to.length);
    expect(sizes).toEqual([50, 50, 20]);
  });

  it('rejects an empty recipient list and an unconfigured provider', async () => {
    await expect(
      sendMail({ to: [], from: { email: 'a@b.ca' }, subject: 's', text: 't' }, resendEnv),
    ).rejects.toBeInstanceOf(EmailSendError);
    await expect(sendMail({ to: 'a@b.ca', from: { email: 'a@b.ca' }, subject: 's' }, {})).rejects.toThrow(
      'No email provider configured',
    );
  });
});

describe('checkEmailProvider (Resend)', () => {
  it('reports no provider when no key is set, without any network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await checkEmailProvider({});
    expect(r.ok).toBe(false);
    expect(r.provider).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a full-access key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { data: [] })));
    expect(await checkEmailProvider(resendEnv)).toMatchObject({ ok: true, provider: 'resend' });
  });

  it('accepts a send-only key (401 restricted_api_key)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(401, { name: 'restricted_api_key', message: 'This API key is restricted to only send emails.' }),
      ),
    );
    expect(await checkEmailProvider(resendEnv)).toMatchObject({ ok: true, detail: expect.stringContaining('sending') });
  });

  it('rejects an invalid key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, { name: 'validation_error', message: 'API key is invalid' })),
    );
    const r = await checkEmailProvider(resendEnv);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('401');
  });

  it('rejects a suspended or inactive key (403)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(403, { name: 'restricted_api_key', message: 'API key is not active' })),
    );
    expect((await checkEmailProvider(resendEnv)).ok).toBe(false);
  });

  it('reports an unreachable provider without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const r = await checkEmailProvider(resendEnv);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('could not reach');
  });
});

describe('checkEmailProvider (SendGrid)', () => {
  it('maps 200 to ok and 401 to not ok', async () => {
    const env: Env = { SENDGRID_API_KEY: 'SG.x' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{}', { status: 200 })));
    expect((await checkEmailProvider(env)).ok).toBe(true);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{}', { status: 401 })));
    const bad = await checkEmailProvider(env);
    expect(bad.ok).toBe(false);
    expect(bad.detail).toContain('401');
  });
});
