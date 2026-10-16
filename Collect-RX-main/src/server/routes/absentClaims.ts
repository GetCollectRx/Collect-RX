import { Router, type Request, type Response } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../middleware/authenticate.js';
import { requirePracticeOwnerRole } from '../middleware/requirePracticeOwnerRole.js';
import { practiceIdFromSession, requirePracticeContext } from '../middleware/requirePracticeSession.js';
import { apiErrorMessageForResponse } from '../apiErrorMessage.js';
import { authUserId } from '../accessControl/types.js';
import { appendAuditLog } from '../audit/auditLog.js';
import { decideAbsentClaims, listClaimsAwaitingConfirmation } from '../pms/absentClaimReview.js';

/**
 * Claims a confirmed full export did not list (DEC-14). Practice owner only:
 * confirming a claim as resolved, or putting it back into calling, is the
 * practice's decision.
 *
 *   GET  /api/claims-not-in-latest-file            claims awaiting staff confirmation
 *   POST /api/claims-not-in-latest-file/decision   { claimIds: string[], decision: 'RESOLVED' | 'RESTORE' }
 */
const router = Router();
router.use(authenticate);
router.use(requirePracticeContext);
router.use(requirePracticeOwnerRole);

const MAX_PER_DECISION = 200;

router.get('/', async (req: Request, res: Response) => {
  try {
    const data = await listClaimsAwaitingConfirmation(prisma, practiceIdFromSession(req));
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[GET /claims-not-in-latest-file]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.post('/decision', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const body = (req.body ?? {}) as { claimIds?: unknown; decision?: unknown };
    if (body.decision !== 'RESOLVED' && body.decision !== 'RESTORE') {
      return res.status(400).json({ success: false, error: 'decision must be RESOLVED or RESTORE' });
    }
    if (
      !Array.isArray(body.claimIds) ||
      body.claimIds.length === 0 ||
      body.claimIds.length > MAX_PER_DECISION ||
      !body.claimIds.every((id) => typeof id === 'string' && id.length > 0)
    ) {
      return res.status(400).json({ success: false, error: `claimIds must list 1 to ${MAX_PER_DECISION} claims` });
    }
    const decidedByUserId = authUserId(req.auth ?? req.practiceAuth);
    if (!decidedByUserId) {
      return res.status(401).json({ success: false, error: 'Session has no identifiable user for the audit trail' });
    }
    const result = await decideAbsentClaims(prisma, {
      practiceId,
      claimIds: [...new Set(body.claimIds as string[])],
      decision: body.decision,
      decidedByUserId,
    });
    void appendAuditLog(prisma, {
      practiceId,
      action: 'claims.not_in_latest_file.decision',
      subjectType: 'insurance_claims',
      subjectId: practiceId,
      details: { decision: body.decision, decided: result.decided, skipped: result.skipped.length },
      req,
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[POST /claims-not-in-latest-file/decision]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

export default router;
