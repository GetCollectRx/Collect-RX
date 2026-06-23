/**
 * Shared guards for unauthenticated `/api/public/*` routes.
 */

/** 32 hex chars — matches `randomBytes(16).toString('hex')` in balances.ts */
export const PUBLIC_PAY_TOKEN_RE = /^[a-f0-9]{32}$/i;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidPublicPayToken(token: string): boolean {
  return PUBLIC_PAY_TOKEN_RE.test(token);
}

export function isValidPatientBalanceId(id: string): boolean {
  return UUID_RE.test(id);
}

export function isReasonableUnsubscribeEmail(email: string): boolean {
  const e = email.trim();
  return e.length >= 3 && e.length <= 254 && EMAIL_RE.test(e);
}

/** Prisma / network failures where retry is appropriate (not "not found"). */
export function isDatabaseUnavailableError(err: unknown): boolean {
  const e = err as { code?: string; name?: string; message?: string };
  if (e.code === 'P1001' || e.code === 'P1017' || e.code === 'P2024') return true;
  if (e.name === 'PrismaClientInitializationError') return true;
  const msg = String(e.message ?? '').toLowerCase();
  return (
    msg.includes("can't reach database") ||
    msg.includes('connection refused') ||
    msg.includes('timed out') ||
    msg.includes('econnrefused')
  );
}

export type PublicJsonError = { status: number; body: { error: string } };

export function publicPayJsonError(err: unknown): PublicJsonError {
  if (isDatabaseUnavailableError(err)) {
    return { status: 503, body: { error: 'Payment service is temporarily unavailable' } };
  }
  return { status: 500, body: { error: 'Failed to load payment' } };
}
