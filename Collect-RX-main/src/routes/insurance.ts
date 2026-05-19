// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Insurance Routes
//
// GET  /api/insurance/claims           — paginated list with filters
// GET  /api/insurance/claims/:id       — claim detail + call history
// POST /api/insurance/claims/import    — CSV import
// POST /api/insurance/queue/trigger/:claimId — manual call trigger
// PATCH /api/insurance/claims/:id      — e.g. servicedAt for appeal deadlines
// POST /api/insurance/claims/:id/confirm-payment — practice AR: record payment, resolve when paid
// GET  /api/insurance/queue            — queue snapshot
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import { CarrierId, ClaimStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { vapiClient } from '../vapi/client';
import { validateDispatch, CARRIER_CONFIGS } from '../carriers/adapter';
import { enqueueEmrClaimEvent } from '../server/emrSyncOutbox.js';
import { getDenialAnalytics } from '../services/insurance-denial-analytics.js';
import { writeDispatchAudit } from '../services/guardrails/index.js';
import { authenticate } from '../server/middleware/authenticate';
import { strictLimiter } from '../server/middleware/rateLimiter';
import {
  practiceIdFromSession,
  queryPracticeConflictsSession,
} from '../server/middleware/requirePracticeSession';

const router = Router();
router.use(authenticate);

// ---------------------------------------------------------------------------
// GET /api/insurance/claims
// Paginated list of claims with optional filters.
//
// Query params:
//   carrier    — CarrierId enum value
//   status     — ClaimStatus enum value
//   aging      — "30-60" | "60-90" | "90+"
//   practiceId — ignored for scope; must match session if sent (legacy UIs)
//   page       — default 1
//   limit      — default 25, max 100
// ---------------------------------------------------------------------------
router.get('/claims', async (req: Request, res: Response) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 25));
    const skip  = (page - 1) * limit;

    const { carrier, status, aging, practiceId: qPractice } = req.query as Record<string, string>;
    if (queryPracticeConflictsSession(req, qPractice)) {
      return res.status(403).json({ success: false, error: 'practiceId does not match session' });
    }

    // Build where clause — always scoped to authenticated practice
    const where: Record<string, unknown> = { practiceId: practiceIdFromSession(req) };
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
// PATCH /api/insurance/claims/:id
// Body: { servicedAt?: ISO8601 string, practiceId?: string } — practiceId must match claim when sent.
// ---------------------------------------------------------------------------
router.patch('/claims/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body as { servicedAt?: string; practiceId?: string };
    const claim = await prisma.insuranceClaim.findUnique({ where: { id } });
    if (!claim || claim.practiceId !== practiceIdFromSession(req)) {
      return res.status(404).json({ success: false, error: 'Claim not found' });
    }
    if (body.practiceId && body.practiceId !== claim.practiceId) {
      return res.status(403).json({ success: false, error: 'practiceId mismatch' });
    }
    const data: { servicedAt?: Date } = {};
    if (body.servicedAt !== undefined) {
      const d = new Date(body.servicedAt);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ success: false, error: 'Invalid servicedAt' });
      }
      data.servicedAt = d;
    }
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ success: false, error: 'No supported fields to update (send servicedAt)' });
    }
    const updated = await prisma.insuranceClaim.update({ where: { id }, data });
    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error('[PATCH /insurance/claims/:id]', err);
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/insurance/claims/:id/confirm-payment
// Body: { practiceId?: string, paymentAmountCents?: number, notes?: string }
// If paymentAmountCents omitted, treats as full payment (outstanding → 0). Emits EMR outbox on RESOLVED.
// ---------------------------------------------------------------------------
router.post('/claims/:id/confirm-payment', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body as { practiceId?: string; paymentAmountCents?: number; notes?: string };
    const claim = await prisma.insuranceClaim.findUnique({ where: { id } });
    if (!claim || claim.practiceId !== practiceIdFromSession(req)) {
      return res.status(404).json({ success: false, error: 'Claim not found' });
    }
    if (body.practiceId && body.practiceId !== claim.practiceId) {
      return res.status(403).json({ success: false, error: 'practiceId mismatch' });
    }

    let remaining = Number(claim.outstandingAmount);
    if (typeof body.paymentAmountCents === 'number' && body.paymentAmountCents > 0) {
      remaining = Math.max(0, Math.round((remaining - body.paymentAmountCents / 100) * 100) / 100);
    } else {
      remaining = 0;
    }

    const newStatus: ClaimStatus = remaining <= 0.009 ? 'RESOLVED' : claim.status;

    const updated = await prisma.insuranceClaim.update({
      where: { id },
      data: {
        outstandingAmount: remaining,
        status: newStatus,
      },
    });

    if (newStatus === 'RESOLVED') {
      try {
        await enqueueEmrClaimEvent(prisma, {
          practiceId: claim.practiceId,
          claimId: id,
          eventType: 'PAYMENT_CONFIRMED',
          payload: {
            notes: body.notes ?? null,
            at: new Date().toISOString(),
            outstandingAfter: remaining,
          },
        });
      } catch (emrErr) {
        console.error('[confirm-payment] EMR outbox:', emrErr);
      }
    }

    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error('[POST /insurance/claims/:id/confirm-payment]', err);
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/claims/:id', async (req: Request, res: Response) => {
  try {
    const claim = await prisma.insuranceClaim.findUnique({
      where: { id: req.params.id },
      include: {
        callAttempts: { orderBy: { initiatedAt: 'desc' } },
        queueEntry: true,
      },
    });

    if (!claim || claim.practiceId !== practiceIdFromSession(req)) {
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
router.post('/claims/import', strictLimiter, async (req: Request, res: Response) => {
  try {
    const body = req.body as { records?: unknown[]; pmsSource?: string } | unknown[];
    const rows = Array.isArray(body) ? body : body?.records;
    if (!Array.isArray(rows)) {
      return res.status(400).json({
        success: false,
        error: 'Expected a JSON array of rows or { records: array }',
      });
    }
    const practiceId = practiceIdFromSession(req);
    const pmsSource = (
      !Array.isArray(body) && body?.pmsSource === 'dentrix' ? 'dentrix' : 'abeldent'
    ) as 'dentrix' | 'abeldent';
    const { runPmsImportPipeline } = await import('../server/pms/pmsImportPipeline.js');
    const result = await runPmsImportPipeline(prisma, {
      practiceId,
      pmsSource,
      rows: rows as Record<string, unknown>[],
      sourceRecordCount: rows.length,
    });
    return res.json({
      success: true,
      imported: result.imported,
      skipped: result.skipped,
      failed: result.failed,
      errors: result.errors,
      runId: result.runId,
    });
  } catch (err) {
    console.error('[POST /insurance/claims/import]', err);
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/analytics/denials', async (req: Request, res: Response) => {
  try {
    const qP = req.query.practiceId as string | undefined;
    if (queryPracticeConflictsSession(req, qP)) {
      return res.status(403).json({ success: false, error: 'practiceId does not match session' });
    }
    const data = await getDenialAnalytics(prisma, practiceIdFromSession(req));
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[GET /insurance/analytics/denials]', err);
    return res.status(500).json({ success: false, error: (err as Error).message });
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
router.post('/queue/trigger/:claimId', strictLimiter, async (req: Request, res: Response) => {
  try {
    const { claimId } = req.params;

    const claim = await prisma.insuranceClaim.findUnique({
      where: { id: claimId },
      include: {
        callAttempts: { select: { id: true } },
        queueEntry: { select: { attempts: true } },
      },
    });

    if (!claim || claim.practiceId !== practiceIdFromSession(req)) {
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
      claimStatus: claim.status,
      scheduledFor: new Date(),
    });

    // Write guardrails audit log (non-blocking)
    try {
      await writeDispatchAudit(claim.id, claim.patientToken, guard);
    } catch (err) {
      console.error('[guardrails] Failed to write dispatch audit:', err);
    }

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
    const qP = req.query.practiceId as string | undefined;
    if (queryPracticeConflictsSession(req, qP)) {
      return res.status(403).json({ success: false, error: 'practiceId does not match session' });
    }
    const where = { practiceId: practiceIdFromSession(req) };

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
