// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Call queue API (priority scores for dispatch ordering).
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { buildPriorityQueue } from '../server/services/priorityEngine';
import { authenticate } from '../server/middleware/authenticate';
import {
  practiceIdFromSession,
  queryPracticeConflictsSession,
} from '../server/middleware/requirePracticeSession';

const router = Router();
router.use(authenticate);

// GET /api/queue/priority-scores?practiceId=... (must match session when provided)
router.get('/priority-scores', async (req: Request, res: Response) => {
  try {
    const qP = typeof req.query.practiceId === 'string' ? req.query.practiceId.trim() : '';
    if (queryPracticeConflictsSession(req, qP || undefined)) {
      return res.status(403).json({ success: false, error: 'practiceId does not match session' });
    }
    const practiceId = practiceIdFromSession(req);

    const ranked = await buildPriorityQueue(prisma, practiceId);
    return res.json({ success: true, data: ranked });
  } catch (err) {
    console.error('[GET /queue/priority-scores]', err);
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
});

export default router;
