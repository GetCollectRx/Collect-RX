import type { Request } from 'express';

/** Practice ID from JWT / cookie (requires `authenticate` first). */
export function practiceIdFromSession(req: Request): string {
  return req.practiceAuth!.practiceId;
}

/**
 * True when the client passed a `practiceId` query/body hint that disagrees with the session.
 * Prevents cross-tenant IDOR when UIs accidentally mix sessions and query params.
 */
export function queryPracticeConflictsSession(req: Request, queryPracticeId: string | undefined): boolean {
  return Boolean(queryPracticeId?.trim() && queryPracticeId.trim() !== req.practiceAuth!.practiceId);
}
