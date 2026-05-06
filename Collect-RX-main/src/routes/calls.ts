// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Calls Routes
//
// GET /api/calls      — full call log with filters
// GET /api/calls/:id  — single call detail
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import { CallOutcome, CarrierId } from '@prisma/client';
import { prisma } from '../lib/prisma';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/calls
// Full call log with filters.
//
// Query params:
//   carrier    — CarrierId value
//   outcome    — CallOutcome value
//   from       — ISO date string (start of date range)
//   to         — ISO date string (end of date range)
//   practiceId — filter by practice
//   page       — default 1
//   limit      — default 25, max 100
// ---------------------------------------------------------------------------
router.get('/', async (req: Request, res: Response) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 25));
    const skip  = (page - 1) * limit;

    const { carrier, outcome, from, to, practiceId } = req.query as Record<string, string>;

    // Build where using a join via claim
    const claimFilter: Record<string, unknown> = {};
    if (practiceId) claimFilter.practiceId = practiceId;
    if (carrier && Object.values(CarrierId).includes(carrier as CarrierId)) {
      claimFilter.carrierId = carrier as CarrierId;
    }

    const attemptFilter: Record<string, unknown> = {};
    if (outcome && Object.values(CallOutcome).includes(outcome as CallOutcome)) {
      attemptFilter.outcome = outcome as CallOutcome;
    }
    if (from || to) {
      attemptFilter.initiatedAt = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to   ? { lte: new Date(to)   } : {}),
      };
    }

    const where = {
      ...attemptFilter,
      ...(Object.keys(claimFilter).length > 0 ? { claim: claimFilter } : {}),
    };

    const [attempts, total] = await Promise.all([
      prisma.callAttempt.findMany({
        where,
        skip,
        take: limit,
        orderBy: { initiatedAt: 'desc' },
        include: {
          claim: {
            select: {
              practiceId: true,
              carrierId: true,
              claimNumber: true,
              outstandingAmount: true,
              daysOutstanding: true,
              status: true,
            },
          },
        },
      }),
      prisma.callAttempt.count({ where }),
    ]);

    return res.json({
      success: true,
      data: attempts,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('[GET /calls]', err);
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/calls/:id
// Single call detail: transcript URL, outcome, rep name, reference number,
// and the associated claim.
// ---------------------------------------------------------------------------
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const attempt = await prisma.callAttempt.findUnique({
      where: { id: req.params.id },
      include: {
        claim: {
          select: {
            practiceId: true,
            carrierId: true,
            claimNumber: true,
            billedAmount: true,
            outstandingAmount: true,
            daysOutstanding: true,
            status: true,
          },
        },
      },
    });

    if (!attempt) {
      return res.status(404).json({ success: false, error: 'Call attempt not found' });
    }

    return res.json({ success: true, data: attempt });
  } catch (err) {
    console.error('[GET /calls/:id]', err);
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
});

export default router;
