import { Router, type Request, type Response } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../middleware/authenticate.js';
import {
  practiceIdFromSession,
  queryPracticeConflictsSession,
} from '../middleware/requirePracticeSession.js';
import { listPmsVendorCatalog } from '../pms/pmsRegistry.js';
import { getPracticePmsContext } from '../pms/practicePmsContext.js';
import { apiErrorMessageForResponse } from '../apiErrorMessage.js';
import { PHONE_DECISION_PROFILE } from '../../types/pms.js';

const router = Router();
router.use(authenticate);

/** Supported PMS vendors and import capabilities (no vendor API keys required). */
router.get('/catalog', (_req: Request, res: Response) => {
  return res.json({
    success: true,
    phoneDecisionProfile: PHONE_DECISION_PROFILE,
    vendors: listPmsVendorCatalog(),
  });
});

/** Resolved PMS context for the signed-in practice. */
router.get('/context', async (req: Request, res: Response) => {
  try {
    const qP = req.query.practiceId as string | undefined;
    if (queryPracticeConflictsSession(req, qP)) {
      return res.status(403).json({ success: false, error: 'practiceId does not match session' });
    }
    const practiceId = practiceIdFromSession(req);
    const pms = await getPracticePmsContext(prisma, practiceId);
    return res.json({ success: true, data: pms });
  } catch (err) {
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

export default router;
