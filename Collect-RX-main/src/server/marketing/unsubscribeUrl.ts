import { createHmac, timingSafeEqual } from 'crypto';
import { getPublicApiBase } from '../email/unsubscribeUrl.js';

const SIG_PREFIX = 'v1';

function prospectUnsubscribeSecret(): string {
  const s = process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.JWT_SECRET;
  if (!s) {
    throw new Error('EMAIL_UNSUBSCRIBE_SECRET or JWT_SECRET required to build prospect unsubscribe links');
  }
  return s;
}

function signProspectToken(prospectId: string): string {
  return createHmac('sha256', prospectUnsubscribeSecret())
    .update(`prospect|${prospectId}`)
    .digest('base64url');
}

/**
 * One-click unsubscribe URL for marketing emails sent to ProspectPractice records.
 * GET to /api/public/prospect-unsubscribe?p=<id>&s=<sig> sets optedOutAt.
 */
export function buildProspectUnsubscribeUrl(baseUrl: string, prospectId: string): string {
  const b = baseUrl || getPublicApiBase();
  const sig = signProspectToken(prospectId);
  return `${b}/api/public/prospect-unsubscribe?p=${encodeURIComponent(prospectId)}&s=${encodeURIComponent(SIG_PREFIX + sig)}`;
}

export function verifyProspectUnsubscribeRequest(prospectId: string, sParam: string | undefined): boolean {
  if (!sParam || !sParam.startsWith(SIG_PREFIX)) return false;
  const sig = sParam.slice(SIG_PREFIX.length);
  const expected = signProspectToken(prospectId);
  if (expected.length !== sig.length) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(sig, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
