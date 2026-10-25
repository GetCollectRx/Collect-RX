import type { Request, Response, NextFunction } from 'express';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { authUserId } from '../accessControl/types.js';
import { practiceIdFromAuth } from '../accessControl/practiceContext.js';
import { appendPhiAccessEvent, appendRequiredAuditLog } from '../audit/auditLog.js';

function resourceId(req: Request): string {
  return req.params.id || req.params.claimId || req.params.patientId || 'collection';
}

/**
 * Mounted only after authenticate. Records a required access intent before a
 * sensitive handler runs; audit-store failure returns 503 and no PHI operation
 * executes.
 */
export function createAuditPhiAccessMiddleware(client: PrismaClient) {
  return async function auditPhiAccess(req: Request, res: Response, next: NextFunction) {
  const auth = req.auth ?? req.practiceAuth;
  if (!auth) return res.status(401).json({ error: 'Authentication required' });
  const practiceId = practiceIdFromAuth(auth, req);
  const actorId = authUserId(auth);
  if (!practiceId || !actorId) {
    return res.status(403).json({ error: 'A validated practice context is required for PHI access' });
  }

  const recordId = resourceId(req);
  const route = `${req.baseUrl}${req.path}`;
  try {
    await appendRequiredAuditLog(client, {
      practiceId,
      userId: actorId,
      action: 'phi.access.intent',
      subjectType: 'ProtectedRoute',
      subjectId: recordId,
      details: { method: req.method, route },
      req,
    });
    await appendPhiAccessEvent(client, {
      practiceId,
      actorId,
      operation: `${req.method.toLowerCase()}:${route}`,
      recordType: 'ProtectedRoute',
      recordId,
      purpose: 'authorized application access',
      required: true,
    });
    return next();
  } catch {
    return res.status(503).json({ error: 'Required audit trail is unavailable; access was not performed' });
  }
  };
}

export const auditPhiAccessMiddleware = createAuditPhiAccessMiddleware(prisma);
