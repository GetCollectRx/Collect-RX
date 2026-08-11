import { Router, type Request, type Response } from 'express';
import { prisma } from '../../lib/prisma';
import {
  practiceIdFromSession,
  queryPracticeConflictsSession,
} from '../middleware/requirePracticeSession';
import { useOwnerPracticeApi } from '../middleware/ownerPracticeApi.js';
import { apiErrorMessageForResponse } from '../apiErrorMessage.js';
import {
  connectorHealth,
  mintConnectorAgent,
  revokeConnectorAgent,
} from '../services/desktopConnectorService.js';
import { appendAuditLog } from '../audit/auditLog.js';
import { logger } from '../observability/logger.js';

const router = Router();
useOwnerPracticeApi(router);

router.get('/agents', async (req: Request, res: Response) => {
  try {
    const qP = req.query.practiceId as string | undefined;
    if (queryPracticeConflictsSession(req, qP)) {
      return res.status(403).json({ success: false, error: 'practiceId does not match session' });
    }
    const practiceId = practiceIdFromSession(req);
    const agents = await prisma.desktopConnectorAgent.findMany({
      where: { practiceId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        label: true,
        hostname: true,
        agentVersion: true,
        platform: true,
        lastHeartbeatAt: true,
        lastSyncAt: true,
        lastSyncStatus: true,
        lastSyncMessage: true,
        lastImported: true,
        revokedAt: true,
        createdAt: true,
      },
    });
    return res.json({
      success: true,
      data: agents.map((a) => ({ ...a, health: connectorHealth(a) })),
    });
  } catch (err) {
    logger.error('[GET /admin/connector/agents]', { error: err });
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.post('/agents', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const label = typeof req.body?.label === 'string' && req.body.label.trim()
      ? req.body.label.trim().slice(0, 80)
      : 'Practice PC';
    const { agent, token } = await mintConnectorAgent(practiceId, label);
    void appendAuditLog(prisma, {
      practiceId,
      action: 'connector.agent.mint',
      subjectType: 'DesktopConnectorAgent',
      subjectId: agent.id,
      details: { label },
    });
    return res.status(201).json({
      success: true,
      data: {
        id: agent.id,
        label: agent.label,
        token,
        createdAt: agent.createdAt,
      },
      message: 'Copy the token now — it will not be shown again.',
    });
  } catch (err) {
    logger.error('[POST /admin/connector/agents]', { error: err });
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.delete('/agents/:id', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const ok = await revokeConnectorAgent(req.params.id, practiceId);
    if (!ok) {
      return res.status(404).json({ success: false, error: 'Connector agent not found or already revoked' });
    }
    void appendAuditLog(prisma, {
      practiceId,
      action: 'connector.agent.revoke',
      subjectType: 'DesktopConnectorAgent',
      subjectId: req.params.id,
    });
    return res.json({ success: true });
  } catch (err) {
    logger.error('[DELETE /admin/connector/agents/:id]', { error: err });
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

export function createConnectorAdminRouter(): Router {
  return router;
}
