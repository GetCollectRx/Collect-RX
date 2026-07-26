import type { Request, Response, NextFunction } from 'express';
import {
  practiceIdFromAuth,
  practiceIdFromRequestHints,
  PRACTICE_CONTEXT_ERROR,
} from '../accessControl/practiceContext.js';
import { isPlatformDev, isCrossPracticeReader, isUserSession, type UserAuthPayload } from '../accessControl/types.js'

/** Practice ID from JWT (user session) or `?practiceId=` / body / X-Practice-Id (platform_dev). */
export function practiceIdFromSession(req: Request): string {
  const auth = req.auth ?? req.practiceAuth;
  if (!auth) {
    throw new Error('authenticate middleware required before practiceIdFromSession');
  }
  const id = practiceIdFromAuth(auth, req);
  if (!id) {
    throw new Error(PRACTICE_CONTEXT_ERROR);
  }
  return id;
}

/**
 * True when the client passed a `practiceId` query/body hint that disagrees with the session.
 * Platform developers and other cross-practice readers (e.g. billing_ops_manager) may target
 * any practice via context param — their JWT carries no fixed practiceId to compare against.
 */
export function queryPracticeConflictsSession(req: Request, queryPracticeId: string | undefined): boolean {
  const auth = req.auth ?? req.practiceAuth;
  if (!auth || isPlatformDev(auth) || isCrossPracticeReader(auth)) return false;
  if (!isUserSession(auth)) return false;
  const practiceId = (auth as UserAuthPayload).practiceId;
  return Boolean(queryPracticeId?.trim() && queryPracticeId.trim() !== practiceId);
}

/** Rejects platform_dev requests that omit practice context (400). */
export function requirePracticeContext(req: Request, res: Response, next: NextFunction): void {
  const auth = req.auth ?? req.practiceAuth;
  if (!auth) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (isUserSession(auth)) {
    next();
    return;
  }
  if (!practiceIdFromRequestHints(req)) {
    res.status(400).json({ error: PRACTICE_CONTEXT_ERROR });
    return;
  }
  next();
}
