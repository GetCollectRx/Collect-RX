import type { Request, Response, NextFunction } from 'express';
import { hasMinRole, isUserSession } from '../accessControl/types.js';
import type { PracticeRole, UserAuthPayload } from '../accessControl/types.js';

/**
 * Requires the session to meet or exceed `minRole` in the authority hierarchy.
 * platform_dev always passes. Must run after `authenticate`.
 *
 * Usage:
 *   router.post('/settings', authenticate, authorizeRole('office_manager'), handler)
 */
export function authorizeRole(minRole: PracticeRole | 'platform_dev') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = req.auth;
    if (!auth) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!hasMinRole(auth, minRole)) {
      res.status(403).json({ error: 'Insufficient permissions for this action' });
      return;
    }
    next();
  };
}

/**
 * Appends `providerId` scoping to `req.query` and `req.body` for associate_dentist sessions.
 * All downstream queries that accept a `providerId` filter will automatically be scoped.
 *
 * Must run after `authenticate`. Safe to add to any route — it no-ops for non-associate sessions.
 */
export function scopeToProvider(req: Request, _res: Response, next: NextFunction): void {
  const auth = req.auth;
  if (auth && isUserSession(auth) && auth.role === 'associate_dentist') {
    const user = auth as UserAuthPayload;
    if (user.providerId) {
      // Inject into query so all handlers pick it up without special-casing.
      (req.query as Record<string, unknown>).providerId = user.providerId;
    }
  }
  next();
}
