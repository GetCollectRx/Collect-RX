import type { Request, Response, NextFunction } from 'express';
import type { Action } from '../accessControl/permissions.js';
import { canPerformAction } from '../accessControl/permissions.js';
import { getUserRole } from '../accessControl/types.js';

/** Rejects requests when the session role is not allowed the MCP-aligned action. */
export function requirePermission(action: Action) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = getUserRole(req.auth ?? req.practiceAuth);
    if (!canPerformAction(role, action)) {
      res.status(403).json({ success: false, error: 'Insufficient role for this action' });
      return;
    }
    next();
  };
}
