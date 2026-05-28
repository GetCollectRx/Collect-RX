import type { Request, Response, NextFunction } from 'express';
import {
  assertAuditorPracticeGrant,
  assertPlatformAdminClaimGrant,
} from './grantChecks.js';
import { practiceIdFromSession } from './requirePracticeSession.js';
import {
  actionRequiresPracticeGrant,
  canPerformAction,
} from '../accessControl/permissions.js';
import type { Action } from '../accessControl/permissions.js';
import { getUserRole, isAuditor } from '../accessControl/types.js';

/**
 * Enforces handoff claim/escalation rules: auditors blocked; platform_admin needs owner grant.
 * Mount after authenticate + requirePracticeContext on owner-scoped routers.
 */
export function requireClaimScope(claimAction: Action = 'list_claims') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const role = getUserRole(req.auth ?? req.practiceAuth);
      if (!canPerformAction(role, claimAction)) {
        if (isAuditor(req.auth ?? req.practiceAuth)) {
          res.status(403).json({ success: false, error: 'Auditors cannot access claim-level data' });
          return;
        }
        res.status(403).json({ success: false, error: 'Insufficient role for this action' });
        return;
      }

      const practiceId = practiceIdFromSession(req);
      if (isAuditor(req.auth ?? req.practiceAuth)) {
        if (!(await assertAuditorPracticeGrant(req, res, practiceId))) return;
      }
      if (actionRequiresPracticeGrant(claimAction)) {
        if (!(await assertPlatformAdminClaimGrant(req, res, practiceId))) return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
