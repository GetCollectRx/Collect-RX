/**
 * Shared guards for unauthenticated `/api/public/*` routes (e.g. email unsubscribe).
 * Patient pay / public payment-token helpers were removed with Practice→Insurance scope.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidPublicUuid(id: string): boolean {
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

export function publicJsonError(err: unknown, unavailableMessage: string, fallbackMessage: string): PublicJsonError {
  if (isDatabaseUnavailableError(err)) {
    return { status: 503, body: { error: unavailableMessage } };
  }
  return { status: 500, body: { error: fallbackMessage } };
}
