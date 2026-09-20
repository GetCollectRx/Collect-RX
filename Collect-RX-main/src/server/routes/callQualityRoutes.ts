/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Call Quality Scoring Routes
 *
 * GET /api/quality/score         — comprehensive quality report (all carriers)
 * GET /api/quality/carrier/:id   — quality metrics for single carrier
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Router, Request, Response } from 'express';
import type { CarrierId } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import {
  scoreCallQuality,
  scoreSingleCarrier,
} from '../services/callQualityScorer.js';
import {
  practiceIdFromSession,
  queryPracticeConflictsSession,
  requirePracticeContext,
} from '../middleware/requirePracticeSession.js';
import { authenticate } from '../middleware/authenticate.js';
import { apiErrorMessageForResponse } from '../apiErrorMessage.js';
import { logger } from '../observability/logger.js';

const router = Router();
router.use(authenticate);
router.use(requirePracticeContext);

/**
 * GET /api/quality/score
 *
 * Comprehensive call quality report across all carriers and agents.
 *
 * Query params:
 *   days        — lookback window (default 30, max 365)
 *   practiceId  — optional, must match session
 */
router.get('/score', async (req: Request, res: Response) => {
  try {
    const qPractice = req.query.practiceId as string | undefined;
    if (queryPracticeConflictsSession(req, qPractice)) {
      return res.status(403).json({ success: false, error: 'practiceId does not match session' });
    }

    const practiceId = practiceIdFromSession(req);
    const days = Math.min(365, parseInt(String(req.query.days ?? '30'), 10) || 30);
    const to = new Date();
    const since = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

    const report = await scoreCallQuality(prisma, {
      since,
      to,
      practiceId,
    });

    return res.json({ success: true, data: report });
  } catch (err) {
    logger.error('[GET /api/quality/score]', { error: err });
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

/**
 * GET /api/quality/carrier/:carrierId
 *
 * Quality metrics for a single carrier.
 *
 * Query params:
 *   days        — lookback window (default 30, max 365)
 *   practiceId  — optional, must match session
 */
router.get('/carrier/:carrierId', async (req: Request, res: Response) => {
  try {
    const qPractice = req.query.practiceId as string | undefined;
    if (queryPracticeConflictsSession(req, qPractice)) {
      return res.status(403).json({ success: false, error: 'practiceId does not match session' });
    }

    const practiceId = practiceIdFromSession(req);
    const carrierId = req.params.carrierId as CarrierId;
    const days = Math.min(365, parseInt(String(req.query.days ?? '30'), 10) || 30);
    const to = new Date();
    const since = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

    const metrics = await scoreSingleCarrier(prisma, carrierId, {
      since,
      to,
      practiceId,
    });

    return res.json({ success: true, data: metrics });
  } catch (err) {
    logger.error('[GET /api/quality/carrier/:carrierId]', { error: err });
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

export function createCallQualityRouter(): Router {
  return router;
}
