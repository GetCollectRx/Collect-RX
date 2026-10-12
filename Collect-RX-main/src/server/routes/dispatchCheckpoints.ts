import { Router, type Request, type Response } from 'express';
import { prisma } from '../../lib/prisma';
import { useOwnerPracticeApi } from '../middleware/ownerPracticeApi.js';
import { practiceIdFromSession, queryPracticeConflictsSession } from '../middleware/requirePracticeSession.js';
import { apiErrorMessageForResponse } from '../apiErrorMessage.js';
import { authUserId } from '../accessControl/types.js';
import { appendAuditLog } from '../audit/auditLog.js';
import {
  CheckpointNotFoundError,
  decideDispatchCheckpoint,
  listDispatchCheckpoints,
} from '../frontDesk/dispatchCheckpoint.js';

/**
 * DEC-9 (b) checkpoint API. Owner-only (front desk gets 403): approving
 * automated calling to a carrier is a practice-owner decision.
 *
 *   GET  /api/dispatch-checkpoints                  checkpoints for the session practice
 *   POST /api/dispatch-checkpoints/:id/decision     { decision: 'APPROVED' | 'REVOKED', notes? }
 */
const router = Router();
useOwnerPracticeApi(router);

router.get('/', async (req: Request, res: Response) => {
  try {
    const qP = typeof req.query.practiceId === 'string' ? req.query.practiceId.trim() : '';
    if (queryPracticeConflictsSession(req, qP || undefined)) {
      return res.status(403).json({ success: false, error: 'practiceId does not match session' });
    }
    const practiceId = practiceIdFromSession(req);
    const data = await listDispatchCheckpoints(prisma, practiceId);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[GET /dispatch-checkpoints]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.post('/:id/decision', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const body = (req.body ?? {}) as { decision?: unknown; notes?: unknown };
    if (body.decision !== 'APPROVED' && body.decision !== 'REVOKED') {
      return res.status(400).json({ success: false, error: 'decision must be APPROVED or REVOKED' });
    }
    const decidedByUserId = authUserId(req.auth ?? req.practiceAuth);
    if (!decidedByUserId) {
      // No decision without an identifiable human: that is the point of the audit trail.
      return res.status(401).json({ success: false, error: 'Session has no identifiable user for the audit trail' });
    }
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) || undefined : undefined;

    const updated = await decideDispatchCheckpoint(prisma, {
      practiceId,
      checkpointId: req.params.id,
      decision: body.decision,
      decidedByUserId,
      notes,
    });
    void appendAuditLog(prisma, {
      practiceId,
      action: 'dispatch.checkpoint.decision',
      subjectType: 'dispatch_checkpoint',
      subjectId: updated.id,
      details: { carrierId: updated.carrierId, decision: body.decision },
      req,
    });
    return res.json({ success: true, data: updated });
  } catch (err) {
    if (err instanceof CheckpointNotFoundError) {
      return res.status(404).json({ success: false, error: err.message });
    }
    console.error('[POST /dispatch-checkpoints/:id/decision]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

export default router;
