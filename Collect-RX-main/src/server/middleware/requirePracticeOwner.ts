import type { Request, Response, NextFunction } from 'express';
import { isFrontDesk } from '../accessControl/types.js';

/** Blocks front_desk sessions from owner-only analytics, settings, and admin APIs. */
export function requirePracticeOwner(req: Request, res: Response, next: NextFunction): void {
  const auth = req.auth ?? req.practiceAuth;
  if (isFrontDesk(auth)) {
    res.status(403).json({ success: false, error: 'This action requires practice owner access' });
    return;
  }
  next();
}
