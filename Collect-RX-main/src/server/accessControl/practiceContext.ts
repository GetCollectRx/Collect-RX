import type { Request } from 'express';
import type { AuthJwtPayload, UserAuthPayload } from './types.js';
import { isPlatformDev, isUserSession } from './types.js';

export const PRACTICE_CONTEXT_ERROR =
  'practiceId query parameter (or X-Practice-Id header) is required for platform developer sessions';

/** Practice id from query, body, or header — used for platform_dev context only. */
export function practiceIdFromRequestHints(req: Request): string | undefined {
  const q = typeof req.query.practiceId === 'string' ? req.query.practiceId.trim() : '';
  if (q) return q;
  const body = req.body as { practiceId?: string } | undefined;
  const b = typeof body?.practiceId === 'string' ? body.practiceId.trim() : '';
  if (b) return b;
  const h = req.headers['x-practice-id'];
  if (typeof h === 'string' && h.trim()) return h.trim();
  return undefined;
}

export function practiceIdFromAuth(auth: AuthJwtPayload, req: Request): string | null {
  if (isUserSession(auth)) return (auth as UserAuthPayload).practiceId;
  // platform_dev: must supply practice context via query/body/header
  if (isPlatformDev(auth)) return practiceIdFromRequestHints(req) ?? null;
  return null;
}
