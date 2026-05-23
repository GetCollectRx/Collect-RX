import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { isUserSession } from '../accessControl/types.js';
import type { UserAuthPayload } from '../accessControl/types.js';

/**
 * P5-04: append-only audit. Do not put names, free-text PHI, or full request bodies in `details`.
 */
export function clientRequestMeta(req: Request | undefined) {
  if (!req) {
    return { requestIp: null as string | null, userAgent: null as string | null };
  }
  const xf = req.headers['x-forwarded-for'];
  const fromXf = typeof xf === 'string' ? xf.split(',')[0]!.trim() : '';
  const requestIp = fromXf || req.ip || (req.socket?.remoteAddress ?? '') || null;
  const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
  return { requestIp, userAgent };
}

/** Extract userId from req.auth if it's a user session. */
function userIdFromRequest(req: Request | undefined): string | undefined {
  if (!req) return undefined;
  const auth = req.auth ?? req.practiceAuth;
  if (auth && isUserSession(auth)) return (auth as UserAuthPayload).userId;
  return undefined;
}

export async function appendAuditLog(
  prisma: PrismaClient,
  input: {
    practiceId: string;
    action: string;
    subjectType?: string;
    subjectId?: string;
    details?: Record<string, unknown> | null;
    req?: Request;
    /** Override userId — use when req.auth is not available (e.g. automated jobs). */
    userId?: string;
  }
): Promise<void> {
  const { requestIp, userAgent } = clientRequestMeta(input.req);
  const userId = input.userId ?? userIdFromRequest(input.req);
  try {
    await prisma.auditLog.create({
      data: {
        practiceId: input.practiceId,
        userId: userId ?? undefined,
        action: input.action,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        details: (input.details ?? undefined) as object | undefined,
        requestIp: requestIp ?? undefined,
        userAgent: userAgent ?? undefined,
      },
    });
  } catch (e) {
    console.error('[audit] append failed (non-fatal)', { action: input.action, err: (e as Error).message });
  }
}
