import type { Request, Response, NextFunction } from 'express';
import type { PrismaClient } from '@prisma/client';
import { getUserRole, isPracticeOwner } from '../accessControl/types.js';
import { practiceIdFromSession } from '../middleware/requirePracticeSession.js';
import { getPracticeSettings } from '../services/practiceSettingsService.js';

/** Practice owner always; office_manager / billing_coordinator when owner toggles allow. */
export function requirePlanUsageAccess(prisma: PrismaClient) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const role = getUserRole(req.auth);
    if (isPracticeOwner(req.auth)) {
      next();
      return;
    }
    if ((role as string) !== 'office_manager' && (role as string) !== 'billing_coordinator') {
      res.status(403).json({ success: false, error: 'Plan usage requires practice owner access' });
      return;
    }
    try {
      const practiceId = practiceIdFromSession(req);
      const settings = await getPracticeSettings(prisma, practiceId);
      const allowed =
        ((role as string) === 'office_manager' && settings.usageVisibleToOfficeManager) ||
        ((role as string) === 'billing_coordinator' && settings.usageVisibleToBillingCoordinator);
      if (!allowed) {
        res.status(403).json({ success: false, error: 'Plan usage visibility is disabled for your role' });
        return;
      }
      next();
    } catch {
      res.status(403).json({ success: false, error: 'Plan usage access denied' });
    }
  };
}
