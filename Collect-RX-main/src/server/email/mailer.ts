/**
 * Transactional mailer. One send path for password resets, invites and
 * practice alerts, with a pluggable provider.
 *
 * Provider choice:
 *   - EMAIL_PROVIDER=resend | sendgrid forces one.
 *   - Otherwise RESEND_API_KEY selects Resend, else SENDGRID_API_KEY selects SendGrid.
 *   - No key means no provider (callers log and skip, as before).
 *
 * Failures throw EmailSendError carrying the provider, HTTP status and the
 * provider's own error name and message. Recipient addresses, bodies and
 * API keys are never put on the error.
 *
 * Marketing and prospect email still call SendGrid directly: it depends on
 * SendGrid event and inbound-parse webhooks, which are outside the pilot.
 */

export type EmailProvider = 'resend' | 'sendgrid';

export interface MailAddress {
  email: string;
  name?: string;
}

export interface MailMessage {
  to: string | string[];
  from: MailAddress;
  subject: string;
  text?: string;
  html?: string;
}

export interface MailSendResult {
  provider: EmailProvider;
  id?: string;
}

export class EmailSendError extends Error {
  readonly provider: EmailProvider;
  readonly status?: number;
  readonly code?: string;

  constructor(provider: EmailProvider, message: string, status?: number, code?: string) {
    super(message);
    this.name = 'EmailSendError';
    this.provider = provider;
    this.status = status;
    this.code = code;
  }
}

const RESEND_BASE = 'https://api.resend.com';
const RESEND_MAX_RECIPIENTS = 50;
const REQUEST_TIMEOUT_MS = 10_000;
const USER_AGENT = 'collectrx-mailer/1.0';

export function getEmailProvider(env: NodeJS.ProcessEnv = process.env): EmailProvider | null {
  const forced = env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (forced === 'resend') return env.RESEND_API_KEY?.trim() ? 'resend' : null;
  if (forced === 'sendgrid') return env.SENDGRID_API_KEY?.trim() ? 'sendgrid' : null;
  if (env.RESEND_API_KEY?.trim()) return 'resend';
  if (env.SENDGRID_API_KEY?.trim()) return 'sendgrid';
  return null;
}

export function isEmailConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return getEmailProvider(env) !== null;
}

/**
 * Sender for a message. EMAIL_FROM_ADDRESS / EMAIL_FROM_NAME win; the older
 * SENDGRID_FROM_* names still work so existing secrets keep applying.
 */
export function resolveFrom(
  fallbackEmail: string,
  fallbackName = 'CollectRx',
  env: NodeJS.ProcessEnv = process.env,
): MailAddress {
  return {
    email: env.EMAIL_FROM_ADDRESS?.trim() || env.SENDGRID_FROM_EMAIL?.trim() || fallbackEmail,
    name: env.EMAIL_FROM_NAME?.trim() || env.SENDGRID_FROM_NAME?.trim() || fallbackName,
  };
}

function formatFrom(from: MailAddress): string {
  const name = from.name?.replace(/[<>"\r\n]/g, '').trim();
  return name ? `${name} <${from.email}>` : from.email;
}

function toList(to: string | string[]): string[] {
  return (Array.isArray(to) ? to : [to]).map((t) => t.trim()).filter(Boolean);
}

async function readResendError(res: Response): Promise<{ code?: string; message: string }> {
  try {
    const body = (await res.json()) as { name?: unknown; message?: unknown };
    return {
      code: typeof body.name === 'string' ? body.name : undefined,
      message: typeof body.message === 'string' ? body.message.slice(0, 200) : `HTTP ${res.status}`,
    };
  } catch {
    return { message: `HTTP ${res.status}` };
  }
}

async function sendViaResend(msg: MailMessage, apiKey: string): Promise<MailSendResult> {
  const recipients = toList(msg.to);
  if (recipients.length === 0) {
    throw new EmailSendError('resend', 'No recipients');
  }
  let lastId: string | undefined;
  for (let i = 0; i < recipients.length; i += RESEND_MAX_RECIPIENTS) {
    const res = await fetch(`${RESEND_BASE}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({
        from: formatFrom(msg.from),
        to: recipients.slice(i, i + RESEND_MAX_RECIPIENTS),
        subject: msg.subject,
        ...(msg.text !== undefined ? { text: msg.text } : {}),
        ...(msg.html !== undefined ? { html: msg.html } : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const { code, message } = await readResendError(res);
      throw new EmailSendError('resend', message, res.status, code);
    }
    const ok = (await res.json().catch(() => ({}))) as { id?: unknown };
    if (typeof ok.id === 'string') lastId = ok.id;
  }
  return { provider: 'resend', id: lastId };
}

async function sendViaSendGrid(msg: MailMessage, apiKey: string): Promise<MailSendResult> {
  const sg = (await import('@sendgrid/mail')).default;
  sg.setApiKey(apiKey);
  try {
    const [response] = await sg.send({
      to: msg.to,
      from: msg.from,
      subject: msg.subject,
      text: msg.text ?? '',
      html: msg.html,
    } as Parameters<typeof sg.send>[0]);
    const id = (response?.headers as Record<string, unknown> | undefined)?.['x-message-id'];
    return { provider: 'sendgrid', id: typeof id === 'string' ? id : undefined };
  } catch (err) {
    const e = err as { code?: number; message?: string; response?: { body?: { errors?: Array<{ message?: string }> } } };
    const detail = e.response?.body?.errors?.[0]?.message ?? e.message ?? 'send failed';
    throw new EmailSendError('sendgrid', String(detail).slice(0, 200), typeof e.code === 'number' ? e.code : undefined);
  }
}

/**
 * Send one message through the configured provider. Throws EmailSendError on
 * failure and Error('No email provider configured') when no key is set.
 */
export async function sendMail(msg: MailMessage, env: NodeJS.ProcessEnv = process.env): Promise<MailSendResult> {
  const provider = getEmailProvider(env);
  if (provider === 'resend') return sendViaResend(msg, env.RESEND_API_KEY!.trim());
  if (provider === 'sendgrid') return sendViaSendGrid(msg, env.SENDGRID_API_KEY!.trim());
  throw new Error('No email provider configured');
}

export interface EmailProviderCheck {
  ok: boolean;
  provider: EmailProvider | null;
  detail: string;
}

/**
 * Ask the provider whether the configured key is accepted, without sending
 * anything. Never throws.
 *
 * Resend: send-only keys cannot call GET /domains and get 401
 * restricted_api_key, which still proves the key exists and is active. A
 * deleted or unknown key gets 401/400 validation_error, a missing key
 * missing_api_key, and a disabled key 403.
 * SendGrid: GET /v3/scopes returns 200 for a live key, 401/403 otherwise.
 */
export async function checkEmailProvider(env: NodeJS.ProcessEnv = process.env): Promise<EmailProviderCheck> {
  const provider = getEmailProvider(env);
  if (!provider) return { ok: false, provider: null, detail: 'no email provider key configured' };
  try {
    if (provider === 'resend') {
      const res = await fetch(`${RESEND_BASE}/domains`, {
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY!.trim()}`, 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) return { ok: true, provider, detail: 'key accepted (full access)' };
      const { code, message } = await readResendError(res);
      if (res.status === 401 && code === 'restricted_api_key') {
        return { ok: true, provider, detail: 'key accepted (sending access only)' };
      }
      return { ok: false, provider, detail: `rejected: HTTP ${res.status} ${code ?? ''} ${message}`.trim() };
    }
    const res = await fetch('https://api.sendgrid.com/v3/scopes', {
      headers: { Authorization: `Bearer ${env.SENDGRID_API_KEY!.trim()}`, 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.ok) return { ok: true, provider, detail: 'key accepted' };
    return { ok: false, provider, detail: `rejected: HTTP ${res.status}` };
  } catch (err) {
    const reason = err instanceof Error ? err.name : 'error';
    return { ok: false, provider, detail: `could not reach provider (${reason})` };
  }
}
