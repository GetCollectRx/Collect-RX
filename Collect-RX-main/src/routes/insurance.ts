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
import { getDenialAnalytics } from '../services/insurance-denial-analytics.js';
import { strictLimiter } from '../server/middleware/rateLimiter';
import {
  practiceIdFromSession,
  queryPracticeConflictsSession,
} from '../server/middleware/requirePracticeSession';
import { useOwnerPracticeApi } from '../server/middleware/ownerPracticeApi.js';
import { requireClaimScope } from '../server/middleware/requireClaimScope.js';
import {
  redactInsuranceClaim,
  redactInsuranceClaimsList,
} from '../server/accessControl/redaction.js';
import { canMakeCall, gateBlockMessage } from '../server/plans/planBridge.js';
import { apiErrorMessageForResponse } from '../server/apiErrorMessage.js';

const router = Router();
useOwnerPracticeApi(router);
router.use(requireClaimScope('list_claims'));

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

    const { carrier, status, aging, practiceId: qPractice, recoveryRoute } = req.query as Record<string, string>;
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
    if (recoveryRoute) {
      where.recoveryRoute = recoveryRoute;
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

    const { enrichClaimsWithRecoveryFields } = await import('../server/recovery/claimRecoveryList.js');
    const recoveryByClaim = await enrichClaimsWithRecoveryFields(prisma, claims);

    const data = redactInsuranceClaimsList(claims as Record<string, unknown>[], req.auth).map(
      (row) => {
        const rec = recoveryByClaim.get(String(row.id));
        return rec
          ? {
              ...row,
              recoveryRoute: rec.recoveryRoute,
              blockingGateTitle: rec.blockingGateTitle,
              scheduledRecallAt: rec.scheduledRecallAt,
              canCallCarrier: rec.canCallCarrier,
              dispatchBlockReason: rec.dispatchBlockReason,
            }
          : row;
      },
    );

    return res.json({
      success: true,
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('[GET /insurance/claims]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
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
    return res.json({
      success: true,
      data: redactInsuranceClaim(updated as Record<string, unknown>, req.auth),
    });
  } catch (err) {
    console.error('[PATCH /insurance/claims/:id]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
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

    const { transitionClaimRecovery } = await import('../server/recovery/transitionClaimRecovery.js');
    const result = await transitionClaimRecovery(prisma, {
      practiceId: claim.practiceId,
      claimId: id,
      kind: 'MANUAL_PAYMENT_CONFIRMED',
      paymentAmountCents: body.paymentAmountCents,
      notes: body.notes,
    });

    const updated = await prisma.insuranceClaim.findUnique({ where: { id } });

    return res.json({
      success: true,
      data: redactInsuranceClaim(updated as Record<string, unknown>, req.auth),
      recovery: result,
    });
  } catch (err) {
    console.error('[POST /insurance/claims/:id/confirm-payment]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/insurance/claims/:id/resolve-escalation
// Body: { resolvedBy?: string, notes?: string }
// Called when staff personally called the carrier and resolved an escalated claim.
// Does NOT require a payment amount — this is human-resolution of an AI-escalated case.
// ---------------------------------------------------------------------------
router.post('/claims/:id/resolve-escalation', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body as { resolvedBy?: string; notes?: string };
    const claim = await prisma.insuranceClaim.findUnique({ where: { id } });
    if (!claim || claim.practiceId !== practiceIdFromSession(req)) {
      return res.status(404).json({ success: false, error: 'Claim not found' });
    }

    const { transitionClaimRecovery } = await import('../server/recovery/transitionClaimRecovery.js');
    const result = await transitionClaimRecovery(prisma, {
      practiceId: claim.practiceId,
      claimId: id,
      kind: 'MANUAL_ESCALATION_RESOLVED',
      resolvedBy: body.resolvedBy,
      notes: body.notes,
    });

    const updated = await prisma.insuranceClaim.findUnique({ where: { id } });

    return res.json({ success: true, data: updated, recovery: result });
  } catch (err) {
    console.error('[POST /insurance/claims/:id/resolve-escalation]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
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

    return res.json({
      success: true,
      data: redactInsuranceClaim(claim as Record<string, unknown>, req.auth),
    });
  } catch (err) {
    console.error('[GET /insurance/claims/:id]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/insurance/claims/:id/recovery — route, gates, sync-verified recovery
// ---------------------------------------------------------------------------
router.get('/claims/:id/recovery', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const { getClaimRecoverySummary } = await import('../server/recovery/claimRecoverySummary.js');
    const summary = await getClaimRecoverySummary(prisma, practiceId, req.params.id);
    if (!summary) {
      return res.status(404).json({ success: false, error: 'Claim not found' });
    }
    return res.json({ success: true, data: summary });
  } catch (err) {
    console.error('[GET /insurance/claims/:id/recovery]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/insurance/claims/import
// CSV import — delegates to src/claims/importer.js (existing module).
// Expects multipart/form-data with a `file` field, or JSON body with `records`.
// ---------------------------------------------------------------------------
router.post('/claims/import', strictLimiter, async (req: Request, res: Response) => {
  try {
    const body = req.body as { records?: unknown[]; pmsSource?: string; pmsVendor?: string } | unknown[];
    const rows = Array.isArray(body) ? body : body?.records;
    if (!Array.isArray(rows)) {
      return res.status(400).json({
        success: false,
        error: 'Expected a JSON array of rows or { records: array }',
      });
    }
    const practiceId = practiceIdFromSession(req);
    const explicitPms =
      !Array.isArray(body) ? body?.pmsVendor ?? body?.pmsSource : undefined;
    const { runPmsImportPipeline } = await import('../server/pms/pmsImportPipeline.js');
    const result = await runPmsImportPipeline(prisma, {
      practiceId,
      pmsSource: explicitPms ?? null,
      rows: rows as Record<string, unknown>[],
      sourceRecordCount: rows.length,
    });
    return res.json({
      success: true,
      pmsVendor: result.pmsVendor,
      imported: result.imported,
      skipped: result.skipped,
      failed: result.failed,
      errors: result.errors,
      runId: result.runId,
      paymentsVerified: result.paymentsVerified,
      dollarsRecoveredSyncVerified: result.dollarsRecoveredSyncVerified,
    });
  } catch (err) {
    console.error('[POST /insurance/claims/import]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
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
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
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
      claimId,
      carrierId: claim.carrierId,
      daysOutstanding: claim.daysOutstanding,
      attemptsSoFar,
      claimStatus: claim.status,
      scheduledFor: new Date(),
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

    const planGate = await canMakeCall(practiceId);
    if (!planGate.allowed && planGate.reason !== 'OVERAGE') {
      return res.status(402).json({
        success: false,
        error: gateBlockMessage(planGate.reason, planGate.overageCentsPerClaim),
        reason: planGate.reason,
      });
    }

    const carrierConfig = CARRIER_CONFIGS[claim.carrierId];

    // Initiate Vapi call
    const vapiResult = await vapiClient.initiateCall({
      claimId: claim.id,
      carrierId: claim.carrierId,
      practiceId,
      patientToken: claim.patientToken,  // UUID from PIIVault — no real PHI
      carrierPhone: carrierConfig.phone,
      claimNumber: claim.claimNumber,
      billedAmount: Number(claim.billedAmount),
      outstandingAmount: Number(claim.outstandingAmount),
    });

    // Update claim status, create CallAttempt row, and update queue atomically
    await prisma.$transaction([
      prisma.callAttempt.create({
        data: {
          claimId: claim.id,
          vapiCallId: vapiResult.vapiCallId,
          initiatedAt: new Date(),
          liveState: 'dialing',
          activeAgent: 'IVR_Navigator',
        },
      }),
      prisma.insuranceClaim.update({
        where: { id: claimId },
        data: { status: 'CALLING' },
      }),
      prisma.callAttempt.create({
        data: {
          claimId,
          vapiCallId: vapiResult.vapiCallId,
          initiatedAt: new Date(),
        },
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
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
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
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/insurance/recovery/gates — practice-wide blocking gate inbox
// ---------------------------------------------------------------------------
router.get('/recovery/gates', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const { listPracticeRecoveryGates } = await import('../server/recovery/claimRecoveryList.js');
    const gates = await listPracticeRecoveryGates(prisma, practiceId);
    return res.json({ success: true, data: gates });
  } catch (err) {
    console.error('[GET /insurance/recovery/gates]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/insurance/recovery/metrics — sync-verified $ recovered (not call status alone)
// ---------------------------------------------------------------------------
router.get('/recovery/metrics', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const { computeRecoveryMetrics } = await import('../server/recovery/recoveryMetrics.js');
    const metrics = await computeRecoveryMetrics(prisma, practiceId);
    return res.json({ success: true, data: metrics });
  } catch (err) {
    console.error('[GET /insurance/recovery/metrics]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/insurance/recovery/router — published decision table
// ---------------------------------------------------------------------------
router.get('/recovery/router', async (_req: Request, res: Response) => {
  const { CLAIM_ROUTER_DECISION_TABLE } = await import('../server/recovery/claimRouter.js');
  return res.json({ success: true, decisionTable: CLAIM_ROUTER_DECISION_TABLE });
});

// ---------------------------------------------------------------------------
// GET /api/insurance/recovery/actions — open recovery gates for a claim
// ---------------------------------------------------------------------------
router.get('/recovery/actions', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const claimId = String(req.query.claimId ?? '').trim();
    if (!claimId) {
      return res.status(400).json({ success: false, error: 'claimId required' });
    }
    const actions = await prisma.claimRecoveryAction.findMany({
      where: { practiceId, claimId, clearedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ success: true, data: actions });
  } catch (err) {
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/insurance/recovery/notifications — gates + trace deadlines
// ---------------------------------------------------------------------------
router.get('/recovery/notifications', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const { listRecoveryNotifications } = await import('../server/recovery/recoveryNotifications.js');
    const items = await listRecoveryNotifications(prisma, practiceId);
    return res.json({ success: true, data: items });
  } catch (err) {
    console.error('[GET /insurance/recovery/notifications]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/insurance/claims/:id/route-explanation — staff "why this route?"
// ---------------------------------------------------------------------------
router.get('/claims/:id/route-explanation', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const { getClaimRouteExplanation } = await import('../server/recovery/routeExplainer.js');
    const explanation = await getClaimRouteExplanation(prisma, practiceId, req.params.id);
    if (!explanation) {
      return res.status(404).json({ success: false, error: 'Claim not found' });
    }
    return res.json({ success: true, data: explanation });
  } catch (err) {
    console.error('[GET /insurance/claims/:id/route-explanation]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/insurance/recovery/actions/:id/clear — practice completed gate (resubmit/docs)
// ---------------------------------------------------------------------------
router.post('/recovery/actions/:id/clear', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const claimId = String((req.body as { claimId?: string }).claimId ?? '').trim();
    if (!claimId) {
      return res.status(400).json({ success: false, error: 'claimId required in body' });
    }
    const { clearRecoveryGate } = await import('../server/recovery/recoveryLoopService.js');
    const result = await clearRecoveryGate(prisma, {
      practiceId,
      claimId,
      actionId: req.params.id,
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(400).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

export default router;
