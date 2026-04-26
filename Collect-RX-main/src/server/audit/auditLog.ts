import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';

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

export async function appendAuditLog(
  prisma: PrismaClient,
  input: {
    practiceId: string;
    action: string;
    subjectType?: string;
    subjectId?: string;
    details?: Record<string, unknown> | null;
    req?: Request;
  }
): Promise<void> {
  const { requestIp, userAgent } = clientRequestMeta(input.req);
  try {
    await prisma.auditLog.create({
      data: {
        practiceId: input.practiceId,
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
