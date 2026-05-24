import type { Request } from 'express';
import { authPracticeId, isCrossPracticeReader } from './types.js';
import type { AuthJwtPayload } from './types.js';

export const PRACTICE_CONTEXT_ERROR =
  'practiceId query parameter (or X-Practice-Id header) is required for cross-practice sessions';

export function practiceIdFromRequestHints(req: Request): string | undefined {
  const q = typeof req.query.practiceId === 'string' ? req.query.practiceId.trim() : '';
  if (q) return q;
  const body = req.body as { practiceId?: string } | undefined;
  const b = typeof body?.practiceId === 'string' ? body.practiceId.trim() : '';
  if (b) return b;
  const h = req.headers['x-practice-id'];
  if (typeof h === 'string' && h.trim()) return h.trim();
  const param = req.params?.practiceId;
  if (typeof param === 'string' && param.trim()) return param.trim();
  return undefined;
}

export function practiceIdFromAuth(auth: AuthJwtPayload, req: Request): string | null {
  if (isCrossPracticeReader(auth)) {
    return practiceIdFromRequestHints(req) ?? authPracticeId(auth) ?? null;
  }
  return authPracticeId(auth);
}

export function sessionRequiresPracticeHint(auth: AuthJwtPayload | undefined): boolean {
  if (!auth) return false;
  return isCrossPracticeReader(auth);
}

export function practiceScopeConflict(
  auth: AuthJwtPayload | undefined,
  queryPracticeId: string | undefined,
): boolean {
  if (!auth || isCrossPracticeReader(auth)) return false;
  const pid = authPracticeId(auth);
  if (!pid) return false;
  return Boolean(queryPracticeId?.trim() && queryPracticeId.trim() !== pid);
}
