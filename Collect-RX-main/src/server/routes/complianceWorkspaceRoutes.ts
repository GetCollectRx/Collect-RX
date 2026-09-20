// ─────────────────────────────────────────────────────────────────────────────
// Compliance Audit Workspace — practice-scoped PHI access trail + export bundles
// ─────────────────────────────────────────────────────────────────────────────

import { Router, type Request, type Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../middleware/authenticate.js';
import {
  practiceIdFromSession,
  requirePracticeContext,
} from '../middleware/requirePracticeSession.js';
import { runComplianceAudit } from '../compliance/auditAgent.js';
import { apiErrorMessageForResponse } from '../apiErrorMessage.js';
import { createHash } from 'node:crypto';
import { CSV_AR_FEATURES, isCsvArFeatureEnabled } from '../featureFlags/csvArFeatures.js';

export const complianceWorkspaceRouter = Router();

complianceWorkspaceRouter.use(authenticate);

complianceWorkspaceRouter.get('/audit', async (req: Request, res: Response) => {
  const auth = req.auth;
  const role = auth && 'role' in auth ? (auth as { role: string }).role : null;

  if (role !== 'platform_admin' && role !== 'auditor' && role !== 'platform_dev') {
    res.status(403).json({ error: 'Compliance audit requires platform_admin or auditor role.' });
    return;
  }

  try {
    const report = await runComplianceAudit();
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: apiErrorMessageForResponse(err) });
  }
});

complianceWorkspaceRouter.get(
  '/phi-access',
  requirePracticeContext,
  async (req: Request, res: Response) => {
    try {
      const practiceId = practiceIdFromSession(req);
      if (!(await isCsvArFeatureEnabled(prisma, practiceId, CSV_AR_FEATURES.COMPLIANCE_WORKSPACE))) {
        res.status(403).json({ success: false, error: 'Compliance workspace is disabled for this practice' });
        return;
      }
      const limit = Math.min(200, parseInt(String(req.query.limit ?? '50'), 10) || 50);
      const events = await prisma.phiAccessEvent.findMany({
        where: { practiceId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      res.json({ success: true, data: events });
    } catch (err) {
      res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
    }
  },
);

complianceWorkspaceRouter.get(
  '/export-bundle',
  requirePracticeContext,
  async (req: Request, res: Response) => {
    try {
      const practiceId = practiceIdFromSession(req);
      if (!(await isCsvArFeatureEnabled(prisma, practiceId, CSV_AR_FEATURES.COMPLIANCE_WORKSPACE))) {
        res.status(403).json({ success: false, error: 'Compliance workspace is disabled for this practice' });
        return;
      }
      const since = new Date(Date.now() - 90 * 86400000);
      const [phiAccess, auditLogs, recoveryEvents] = await Promise.all([
        prisma.phiAccessEvent.findMany({
          where: { practiceId, createdAt: { gte: since } },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.auditLog.findMany({
          where: { practiceId, createdAt: { gte: since } },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            action: true,
            subjectType: true,
            subjectId: true,
            createdAt: true,
            userId: true,
          },
        }),
        prisma.claimRecoveryEvent.findMany({
          where: { practiceId, createdAt: { gte: since } },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            claimId: true,
            eventType: true,
            createdAt: true,
            amountRecoveredCents: true,
          },
        }),
      ]);

      const bundle = {
        generatedAt: new Date().toISOString(),
        practiceId,
        windowDays: 90,
        phiAccess,
        auditLogs,
        recoveryEvents,
      };
      const checksum = createHash('sha256').update(JSON.stringify(bundle)).digest('hex');
      res.json({ success: true, data: bundle, checksum });
    } catch (err) {
      res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
    }
  },
);
