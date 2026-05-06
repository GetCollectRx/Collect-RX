// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Insurance Routes
//
// GET  /api/insurance/claims           — paginated list with filters
// GET  /api/insurance/claims/:id       — claim detail + call history
// POST /api/insurance/claims/import    — CSV import
// POST /api/insurance/queue/trigger/:claimId — manual call trigger
// GET  /api/insurance/queue            — queue snapshot
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import { CarrierId, ClaimStatus, QueueStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { vapiClient } from '../vapi/client';
import { validateDispatch, CARRIER_CONFIGS } from '../carriers/adapter';
import { piiVault } from '../services/pii-vault';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/insurance/claims
// Paginated list of claims with optional filters.
//
// Query params:
//   carrier    — CarrierId enum value
//   status     — ClaimStatus enum value
//   aging      — "30-60" | "60-90" | "90+"
//   practiceId — filter by practice
//   page       — default 1
//   limit      — default 25, max 100
// ---------------------------------------------------------------------------
router.get('/claims', async (req: Request, res: Response) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 25));
    const skip  = (page - 1) * limit;

    const { carrier, status, aging, practiceId } = req.query as Record<string, string>;

    // Build where clause
    const where: Record<string, unknown> = {};
    if (practiceId) where.practiceId = practiceId;
    if (carrier && Object.values(CarrierId).includes(carrier as CarrierId)) {
      where.carrierId = carrier as CarrierId;
    }
    if (status && Object.values(ClaimStatus).includes(status as ClaimStatus)) {
      where.status = status as ClaimStatus;
    }
    if (aging) {
      if (aging === '30-60') {
        where.daysOutstanding = { gte: 30, lte: 60 };
      } else if (aging === '60-90') {
        where.daysOutstanding = { gt: 60, lte: 90 };
      } else if (aging === '90+') {
        where.daysOutstanding = { gt: 90 };
      }
    }

    const [claims, total] = await Promise.all([
      prisma.insuranceClaim.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ priority: 'desc' }, { daysOutstanding: 'desc' }],
        include: {
          _count: { select: { callAttempts: true } },
          queueEntry: { select: { status: true, attempts: true, scheduledFor: true } },
        },
      }),
      prisma.insuranceClaim.count({ where }),
    ]);

    return res.json({
      success: true,
      data: claims,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('[GET /insurance/claims]', err);
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/insurance/claims/:id
// Claim detail with full call history.
// ---------------------------------------------------------------------------
router.get('/claims/:id', async (req: Request, res: Response) => {
  try {
    const claim = await prisma.insuranceClaim.findUnique({
      where: { id: req.params.id },
      include: {
        callAttempts: { orderBy: { initiatedAt: 'desc' } },
        queueEntry: true,
      },
    });

    if (!claim) {
      return res.status(404).json({ success: false, error: 'Claim not found' });
    }

    return res.json({ success: true, data: claim });
  } catch (err) {
    console.error('[GET /insurance/claims/:id]', err);
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/insurance/claims/import
// CSV import — delegates to src/claims/importer.js (existing module).
// Expects multipart/form-data with a `file` field, or JSON body with `records`.
// ---------------------------------------------------------------------------
router.post('/claims/import', async (req: Request, res: Response) => {
  try {
    // Dynamic require so the JS importer doesn't need TypeScript declarations
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { importClaims } = require('../claims/importer');
    const result = await importClaims(req.body, prisma);
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[POST /insurance/claims/import]', err);
    // Provide actionable error if importer module is missing
    const msg = (err as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND'
      ? 'Claim importer not found — ensure src/claims/importer.js exists'
      : (err as Error).message;
    return res.status(500).json({ success: false, error: msg });
  }
});

// ---------------------------------------------------------------------------
// POST /api/insurance/queue/trigger/:claimId
// Manually trigger a call for a specific claim right now.
//
// Respects all safety rules:
//   - CARRIER_BLOCK check
//   - Days outstanding rules (< 30 reject, > 90 escalate)
//   - Max 3 attempts
//   - Business hours (Mon–Fri 08:00–17:00 Eastern)
// ---------------------------------------------------------------------------
router.post('/queue/trigger/:claimId', async (req: Request, res: Response) => {
  try {
    const { claimId } = req.params;

    const claim = await prisma.insuranceClaim.findUnique({
      where: { id: claimId },
      include: {
        callAttempts: { select: { id: true } },
        queueEntry: { select: { attempts: true } },
      },
    });

    if (!claim) {
      return res.status(404).json({ success: false, error: 'Claim not found' });
    }

    const attemptsSoFar = claim.queueEntry?.attempts ?? claim.callAttempts.length;
    const practiceId = claim.practiceId;

    // Validate all dispatch rules
    const guard = await validateDispatch(prisma, {
      practiceId,
      carrierId: claim.carrierId,
      daysOutstanding: claim.daysOutstanding,
      attemptsSoFar,
    });

    if (!guard.allowed) {
      // If > 90 days → auto-escalate
      if (claim.daysOutstanding > 90) {
        await prisma.insuranceClaim.update({
          where: { id: claimId },
          data: { status: 'ESCALATED' },
        });
        if (claim.queueEntry) {
          await prisma.callQueue.update({
            where: { claimId },
            data: { status: 'ESCALATED' },
          });
        }
      }
      return res.status(422).json({ success: false, error: guard.reason });
    }

    const carrierConfig = CARRIER_CONFIGS[claim.carrierId];

    // Initiate Vapi call
    const vapiResult = await vapiClient.initiateCall({
      claimId: claim.id,
      carrierId: claim.carrierId,
      patientToken: claim.patientToken,  // UUID from PIIVault — no real PHI
      carrierPhone: carrierConfig.phone,
      claimNumber: claim.claimNumber,
      billedAmount: Number(claim.billedAmount),
      outstandingAmount: Number(claim.outstandingAmount),
    });

    // Update claim status and queue
    await prisma.$transaction([
      prisma.insuranceClaim.update({
        where: { id: claimId },
        data: { status: 'CALLING' },
      }),
      prisma.callQueue.upsert({
        where: { claimId },
        create: {
          practiceId,
          claimId,
          scheduledFor: new Date(),
          priority: claim.priority,
          attempts: 1,
          lastAttemptAt: new Date(),
          status: 'IN_PROGRESS',
        },
        update: {
          status: 'IN_PROGRESS',
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
        },
      }),
    ]);

    return res.json({
      success: true,
      vapiCallId: vapiResult.vapiCallId,
      status: vapiResult.status,
    });
  } catch (err) {
    console.error('[POST /insurance/queue/trigger/:claimId]', err);
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/insurance/queue
// Current queue snapshot: pending, in-progress, completed today.
// ---------------------------------------------------------------------------
router.get('/queue', async (req: Request, res: Response) => {
  try {
    const practiceId = req.query.practiceId as string | undefined;
    const where = practiceId ? { practiceId } : {};

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [pending, inProgress, completedToday, escalated, blocked] = await Promise.all([
      prisma.callQueue.count({ where: { ...where, status: 'PENDING' } }),
      prisma.callQueue.count({ where: { ...where, status: 'IN_PROGRESS' } }),
      prisma.callQueue.count({
        where: { ...where, status: 'COMPLETED', updatedAt: { gte: todayStart } },
      }),
      prisma.callQueue.count({ where: { ...where, status: 'ESCALATED' } }),
      prisma.callQueue.count({ where: { ...where, status: 'BLOCKED' } }),
    ]);

    // Next scheduled items
    const upcoming = await prisma.callQueue.findMany({
      where: { ...where, status: 'PENDING' },
      orderBy: [{ priority: 'desc' }, { scheduledFor: 'asc' }],
      take: 10,
      include: {
        claim: {
          select: {
            carrierId: true,
            claimNumber: true,
            outstandingAmount: true,
            daysOutstanding: true,
          },
        },
      },
    });

    return res.json({
      success: true,
      snapshot: { pending, inProgress, completedToday, escalated, blocked },
      upcoming,
    });
  } catch (err) {
    console.error('[GET /insurance/queue]', err);
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
});

export default router;
