import type { Request, Response, NextFunction } from 'express';
import type { UserRole } from '../../types/userRole.js';
import {
  getUserRole,
  isAuditor,
  isBillingOpsManager,
  isFrontDesk,
  isPlatformAdmin,
  isPracticeOwner,
} from '../accessControl/types.js';

export function requireUserRoles(...allowed: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = getUserRole(req.auth ?? req.practiceAuth);
    if (!role || !allowed.includes(role)) {
      res.status(403).json({ success: false, error: 'Insufficient role for this action' });
      return;
    }
    next();
  };
}

/** Live console intervention — front desk only (brief §10). */
export function requireFrontDeskOnly(req: Request, res: Response, next: NextFunction): void {
  if (!isFrontDesk(req.auth ?? req.practiceAuth)) {
    res.status(403).json({ success: false, error: 'Front desk access required' });
    return;
  }
  next();
}

/** Reports and settings — not front desk. */
export function blockFrontDeskReports(req: Request, res: Response, next: NextFunction): void {
  if (isFrontDesk(req.auth ?? req.practiceAuth)) {
    res.status(403).json({ success: false, error: 'Reports are not available for front desk' });
    return;
  }
  next();
}

export function blockAuditorWrites(req: Request, res: Response, next: NextFunction): void {
  if (isAuditor(req.auth ?? req.practiceAuth)) {
    res.status(403).json({ success: false, error: 'Auditors have read-only access' });
    return;
  }
  next();
}

export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!isPlatformAdmin(req.auth ?? req.practiceAuth)) {
    res.status(403).json({ success: false, error: 'Platform admin access required' });
    return;
  }
  next();
}

export function requireBillingOps(req: Request, res: Response, next: NextFunction): void {
  if (!isBillingOpsManager(req.auth ?? req.practiceAuth)) {
    res.status(403).json({ success: false, error: 'Billing ops access required' });
    return;
  }
  next();
}

export function requirePracticeOwnerOrBillingOps(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const auth = req.auth ?? req.practiceAuth;
  if (!isPracticeOwner(auth) && !isBillingOpsManager(auth)) {
    res.status(403).json({ success: false, error: 'Practice owner or billing ops required' });
    return;
  }
  next();
}
