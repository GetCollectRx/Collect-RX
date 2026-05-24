import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { isAuditor, isPlatformAdmin } from '../accessControl/types.js';

/** Auditor may only read practices they are granted. */
export async function assertAuditorPracticeGrant(
  req: Request,
  res: Response,
  practiceId: string,
): Promise<boolean> {
  const auth = req.auth ?? req.practiceAuth;
  if (!isAuditor(auth) || !auth?.userId) return true;

  const grants = await prisma.auditorGrant.findMany({
    where: { auditorUserId: auth.userId },
  });
  if (grants.some((g) => g.practiceId === null)) return true;
  if (grants.some((g) => g.practiceId === practiceId)) return true;

  res.status(403).json({ success: false, error: 'No auditor grant for this practice' });
  return false;
}

/** Platform admin claim access requires owner grant. */
export async function assertPlatformAdminClaimGrant(
  req: Request,
  res: Response,
  practiceId: string,
): Promise<boolean> {
  const auth = req.auth ?? req.practiceAuth;
  if (!isPlatformAdmin(auth) || !auth?.userId) return true;

  const grant = await prisma.platformAdminPracticeGrant.findUnique({
    where: {
      adminUserId_practiceId: { adminUserId: auth.userId, practiceId },
    },
  });
  if (grant) return true;

  res.status(403).json({
    success: false,
    error:
      'Claim access not granted for this practice. Request access from the practice owner.',
  });
  return false;
}

type GrantHandler = (req: Request, res: Response, next: NextFunction) => Promise<void> | void;

export function withGrantChecks(handler: GrantHandler): GrantHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const practiceId = req.params.practiceId;
      if (typeof practiceId !== 'string') {
        res.status(400).json({ success: false, error: 'practiceId required' });
        return;
      }
      if (!(await assertAuditorPracticeGrant(req, res, practiceId))) return;
      if (!(await assertPlatformAdminClaimGrant(req, res, practiceId))) return;
      await handler(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}
