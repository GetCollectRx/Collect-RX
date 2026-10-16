import type { NextFunction, Request, Response } from 'express';

/**
 * Practice owner only. Checks the literal session role: requirePracticeOwner()
 * lets every non-front-desk role through (office manager, billing coordinator,
 * accountant, associate dentist, and others), which is too wide for decisions
 * that stop or start carrier calling.
 */
export function requirePracticeOwnerRole(req: Request, res: Response, next: NextFunction): void {
  const auth = req.auth ?? req.practiceAuth;
  if (auth?.role !== 'practice_owner') {
    res.status(403).json({ success: false, error: 'Only the practice owner can do this' });
    return;
  }
  next();
}
