import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Twilio request signature check: base64(HMAC-SHA1(authToken, url + sorted
 * key/value pairs)). Every conference webhook must pass this before acting.
 */
export function validTwilioSignature(
  authToken: string,
  signature: string | undefined,
  url: string,
  params: Record<string, string>,
): boolean {
  if (!authToken || !signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expected = createHmac('sha1', authToken).update(data).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
