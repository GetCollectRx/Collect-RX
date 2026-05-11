// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Analytics Routes
//
// GET /api/analytics/insurance — time saved, dollars recovered,
//                                resolution rates, call volume over time
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import {
  getTimeSaved,
  getDollarsRecovered,
  getResolutionRateByCarrier,
  getCallVolumeOverTime,
} from '../services/insurance-analytics';
import { authenticate } from '../server/middleware/authenticate';
import {
  practiceIdFromSession,
  queryPracticeConflictsSession,
} from '../server/middleware/requirePracticeSession';

const router = Router();
router.use(authenticate);

// ---------------------------------------------------------------------------
// GET /api/analytics/insurance
// Aggregate metrics for the practice dashboard.
//
// Query params:
//   practiceId — optional; must match session when sent (metrics always scoped to session)
//   from       — ISO date (default: 30 days ago)
//   to         — ISO date (default: now)
//   bucket     — "day" | "week" (for call volume chart, default "day")
// ---------------------------------------------------------------------------
router.get('/insurance', async (req: Request, res: Response) => {
  try {
    const qPractice = req.query.practiceId as string | undefined;
    if (queryPracticeConflictsSession(req, qPractice)) {
      return res.status(403).json({ success: false, error: 'practiceId does not match session' });
    }
    const practiceId = practiceIdFromSession(req);
    const bucket = (req.query.bucket as 'day' | 'week') ?? 'day';

    const to   = req.query.to   ? new Date(req.query.to as string)   : new Date();
    const from = req.query.from
      ? new Date(req.query.from as string)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const dateRange = { from, to };

    const [timeSaved, dollarsRecovered, resolutionByCarrier, callVolume] = await Promise.all([
      getTimeSaved(prisma, practiceId, dateRange),
      getDollarsRecovered(prisma, practiceId, dateRange),
      getResolutionRateByCarrier(prisma, practiceId),
      getCallVolumeOverTime(prisma, practiceId, dateRange, bucket),
    ]);

    return res.json({
      success: true,
      data: {
        timeSaved,
        dollarsRecovered,
        resolutionByCarrier,
        callVolume,
        window: { from: from.toISOString(), to: to.toISOString() },
      },
    });
  } catch (err) {
    console.error('[GET /analytics/insurance]', err);
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
});

export default router;
