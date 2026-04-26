import { createHmac, timingSafeEqual } from 'crypto';

const SIG_PREFIX = 'v1';

/**
 * Public API base for links embedded in email (unsubscribe). Prefer PUBLIC_API_BASE_URL in production
 * if the API host differs from the Vite app (PUBLIC_APP_URL).
 */
export function getPublicApiBase(): string {
  const raw = process.env.PUBLIC_API_BASE_URL || process.env.PUBLIC_APP_URL || 'http://localhost:3000';
  return String(raw).replace(/\/$/, '');
}

function unsubscribeSecret(): string {
  const s = process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.JWT_SECRET;
  if (!s) {
    throw new Error('EMAIL_UNSUBSCRIBE_SECRET or JWT_SECRET is required to build email unsubscribe links');
  }
  return s;
}

export function signUnsubscribeToken(balanceId: string, emailLower: string): string {
  const secret = unsubscribeSecret();
  return createHmac('sha256', secret)
    .update(`${balanceId}|${emailLower.toLowerCase().trim()}`)
    .digest('base64url');
}

/**
 * P4-02: one-click list-unsubscribe URL. GET applies opt-out in DB.
 */
export function buildEmailUnsubscribeUrl(balanceId: string, patientEmail: string): string {
  if (!patientEmail || !balanceId) {
    return '';
  }
  const b = getPublicApiBase();
  const email = patientEmail.toLowerCase().trim();
  const s = signUnsubscribeToken(balanceId, email);
  return `${b}/api/public/email-unsubscribe?b=${encodeURIComponent(balanceId)}&e=${encodeURIComponent(
    email
  )}&s=${encodeURIComponent(SIG_PREFIX + s)}`;
}

/**
 * s param is "v1" + base64url hmac. Constant-time check.
 */
export function verifyUnsubscribeRequest(balanceId: string, email: string, sParam: string | undefined): boolean {
  if (!sParam || !sParam.startsWith(SIG_PREFIX)) {
    return false;
  }
  const sig = sParam.slice(SIG_PREFIX.length);
  const expected = signUnsubscribeToken(balanceId, email);
  if (expected.length !== sig.length) {
    return false;
  }
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(sig, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
