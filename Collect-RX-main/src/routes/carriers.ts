// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Carriers Routes
//
// GET  /api/carriers/health      — per-carrier: acceptance rate, avg hold,
//                                  resolution rate, block status
// POST /api/carriers/:id/unblock — resume calls after a block event
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import { CarrierId } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { CARRIER_CONFIGS } from '../carriers/adapter';
import {
  practiceIdFromSession,
  queryPracticeConflictsSession,
} from '../server/middleware/requirePracticeSession';
import { useOwnerPracticeApi } from '../server/middleware/ownerPracticeApi.js';
import { apiErrorMessageForResponse } from '../server/apiErrorMessage.js';
import { carrierUnblockBodySchema, formatZodError } from '../server/validation/zodSchemas.js';

const router = Router();
useOwnerPracticeApi(router);

// ---------------------------------------------------------------------------
// GET /api/carriers/health
// Per-carrier metrics: acceptance rate, avg hold time, resolution rate,
// current block status.
//
// Query params:
//   practiceId — must match session if sent
//   from       — ISO date (default: 30 days ago)
//   to         — ISO date (default: now)
// ---------------------------------------------------------------------------
router.get('/health', async (req: Request, res: Response) => {
  try {
    const qP = req.query.practiceId as string | undefined;
    if (queryPracticeConflictsSession(req, qP)) {
      return res.status(403).json({ success: false, error: 'practiceId does not match session' });
    }
    const practiceId = practiceIdFromSession(req);
    const to   = req.query.to   ? new Date(req.query.to as string)   : new Date();
    const from = req.query.from
      ? new Date(req.query.from as string)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const claimWhere: Record<string, unknown> = { practiceId };

    // Fetch all call attempts in window with carrier info via claim join
    const attempts = await prisma.callAttempt.findMany({
      where: {
        initiatedAt: { gte: from, lte: to },
        claim: claimWhere,
      },
      select: {
        outcome: true,
        durationSeconds: true,
        carrierBlockDetected: true,
        claim: { select: { carrierId: true } },
      },
    });

    // Active block status per carrier (and practice if filtered)
    const blockQuery: Record<string, unknown> = { resumedAt: null, practiceId };

    const activeBlocks = await prisma.carrierBlockEvent.findMany({
      where: blockQuery,
      select: { carrierId: true, blockedAt: true },
    });

    const activeBlockMap = new Map<CarrierId, Date>();
    for (const b of activeBlocks) {
      if (!activeBlockMap.has(b.carrierId) || b.blockedAt > activeBlockMap.get(b.carrierId)!) {
        activeBlockMap.set(b.carrierId, b.blockedAt);
      }
    }

    // Aggregate per carrier
    const stats: Record<string, {
      carrierId: string;
      displayName: string;
      totalCalls: number;
      resolvedCalls: number;
      resolutionRate: number;
      avgHoldMinutes: number;
      blockDetections: number;
      isBlocked: boolean;
      blockedSince: string | null;
    }> = {};

    for (const [cid, cfg] of Object.entries(CARRIER_CONFIGS)) {
      stats[cid] = {
        carrierId: cid,
        displayName: cfg.displayName,
        totalCalls: 0,
        resolvedCalls: 0,
        resolutionRate: 0,
        avgHoldMinutes: cfg.avgHoldMinutes,  // baseline from config
        blockDetections: 0,
        isBlocked: activeBlockMap.has(cid as CarrierId),
        blockedSince: activeBlockMap.get(cid as CarrierId)?.toISOString() ?? null,
      };
    }

    let totalDurationSeconds = 0;
    let callsWithDuration = 0;

    for (const a of attempts) {
      const cid = a.claim.carrierId;
      if (!stats[cid]) continue;

      stats[cid].totalCalls++;
      if (a.outcome === 'RESOLVED') stats[cid].resolvedCalls++;
      if (a.carrierBlockDetected) stats[cid].blockDetections++;
      if (a.durationSeconds) {
        totalDurationSeconds += a.durationSeconds;
        callsWithDuration++;
        // Update avg hold with actual data
        stats[cid].avgHoldMinutes = Math.round(
          (stats[cid].avgHoldMinutes + a.durationSeconds / 60) / 2,
        );
      }
    }

    // Compute resolution rates
    for (const s of Object.values(stats)) {
      s.resolutionRate = s.totalCalls > 0
        ? Math.round((s.resolvedCalls / s.totalCalls) * 100)
        : 0;
    }

    return res.json({
      success: true,
      data: Object.values(stats),
      window: { from: from.toISOString(), to: to.toISOString() },
    });
  } catch (err) {
    console.error('[GET /carriers/health]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/carriers/:id/unblock
// Resume calls after a CARRIER_BLOCK event.
//
// Body: { resumedBy: string, notes?: string }
//
// This sets resumed_at on all active block events for this practice+carrier.
// Also unblocks all BLOCKED queue entries for this carrier.
// ---------------------------------------------------------------------------
router.post('/:id/unblock', async (req: Request, res: Response) => {
  try {
    const carrierId = req.params.id as CarrierId;

    if (!Object.values(CarrierId).includes(carrierId)) {
      return res.status(400).json({ success: false, error: `Unknown carrier: ${carrierId}` });
    }

    const parsed = carrierUnblockBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: formatZodError(parsed.error) });
    }
    const { resumedBy, notes, practiceId: bodyPracticeId } = parsed.data;

    const sessionPid = practiceIdFromSession(req);
    if (queryPracticeConflictsSession(req, bodyPracticeId)) {
      return res.status(403).json({ success: false, error: 'practiceId does not match session' });
    }

    const blockWhere: Record<string, unknown> = {
      carrierId,
      resumedAt: null,
      practiceId: sessionPid,
    };

    // Resolve all active blocks for this carrier
    const updateResult = await prisma.carrierBlockEvent.updateMany({
      where: blockWhere,
      data: {
        resumedAt: new Date(),
        resumedBy,
        notes: notes ?? null,
      },
    });

    if (updateResult.count === 0) {
      return res.status(404).json({
        success: false,
        error: `No active block found for carrier ${carrierId} / practice ${sessionPid}`,
      });
    }

    // Reactivate BLOCKED queue entries for this carrier (set back to PENDING)
    const claimWhere: Record<string, unknown> = { carrierId, practiceId: sessionPid };

    await prisma.callQueue.updateMany({
      where: {
        status: 'BLOCKED',
        claim: claimWhere,
      },
      data: { status: 'PENDING' },
    });

    console.log(`[carriers/unblock] ${carrierId} unblocked by ${resumedBy}. ${updateResult.count} block event(s) resolved.`);

    return res.json({
      success: true,
      message: `Calls to ${CARRIER_CONFIGS[carrierId]?.displayName ?? carrierId} resumed`,
      blocksResolved: updateResult.count,
    });
  } catch (err) {
    console.error('[POST /carriers/:id/unblock]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

export default router;
