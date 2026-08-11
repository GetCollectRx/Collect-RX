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
import { writeDispatchAudit } from '../services/guardrails/index.js';
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
import { getPracticeSettings } from '../server/services/practiceSettingsService.js';
import { apiErrorMessageForResponse } from '../server/apiErrorMessage.js';
import { piiVault } from '../pii-vault.js';
import logger from '../server/observability/logger.js';
import { appendAuditLog, appendPhiAccessEvent } from '../server/audit/auditLog.js';
import { compensateFailedManualDispatch } from '../server/insurance/manualDispatchCompensation.js';
import { createEscalation } from '../server/services/escalationService.js';
import { sendPracticeNotification } from '../server/services/practiceNotificationService.js';
import { CSV_AR_FEATURES, isCsvArFeatureEnabled } from '../server/featureFlags/csvArFeatures.js';

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
    const where: Record<string, unknown> = {
      practiceId: practiceIdFromSession(req),
      deletedAt: null,
    };
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
          callAttempts: {
            orderBy: { initiatedAt: 'desc' },
            take: 1,
            select: { outcome: true, outcomeDetail: true },
          },
        },
      }),
      prisma.insuranceClaim.count({ where }),
    ]);

    const { enrichClaimsWithRecoveryFields } = await import('../server/recovery/claimRecoveryList.js');
    const recoveryByClaim = await enrichClaimsWithRecoveryFields(prisma, claims);

    const data = redactInsuranceClaimsList(claims as Record<string, unknown>[], req.auth).map(
      (row) => {
        const attempts = row.callAttempts as
          | { outcome: string | null; outcomeDetail: string | null }[]
          | undefined;
        const latest = attempts?.[0];
        const { callAttempts: _omit, ...base } = row;
        const rec = recoveryByClaim.get(String(row.id));
        return {
          ...base,
          lastOutcome: latest?.outcome ?? null,
          lastOutcomeDetail: latest?.outcomeDetail ?? null,
          ...(rec
            ? {
                recoveryRoute: rec.recoveryRoute,
                blockingGateTitle: rec.blockingGateTitle,
                scheduledRecallAt: rec.scheduledRecallAt,
                canCallCarrier: rec.canCallCarrier,
                dispatchBlockReason: rec.dispatchBlockReason,
              }
            : {}),
        };
      },
    );

    return res.json({
      success: true,
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error('[GET /insurance/claims]', { error: err });
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
    const claim = await prisma.insuranceClaim.findFirst({
      where: { id, practiceId: practiceIdFromSession(req), deletedAt: null },
    });
    if (!claim) {
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
    logger.error('[PATCH /insurance/claims/:id]', { error: err });
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/insurance/claims/:id
// Retains immutable claim/call history while removing the claim from all
// operational claim and dispatch reads.
// ---------------------------------------------------------------------------
router.delete('/claims/:id', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const claim = await prisma.insuranceClaim.findFirst({
      where: { id: req.params.id, practiceId, deletedAt: null },
      select: { id: true, status: true, queueEntry: { select: { id: true } } },
    });
    if (!claim) {
      return res.status(404).json({ success: false, error: 'Claim not found' });
    }
    if (claim.status === 'CALLING') {
      return res.status(409).json({
        success: false,
        error: 'An active call must finish before its claim can be deleted',
      });
    }

    await prisma.$transaction([
      prisma.insuranceClaim.update({
        where: { id: claim.id },
        data: { deletedAt: new Date() },
      }),
      ...(claim.queueEntry
        ? [
            prisma.callQueue.update({
              where: { id: claim.queueEntry.id },
              data: { status: 'COMPLETED' },
            }),
          ]
        : []),
    ]);
    await appendAuditLog(prisma, {
      practiceId,
      action: 'INSURANCE_CLAIM_SOFT_DELETED',
      subjectType: 'InsuranceClaim',
      subjectId: claim.id,
      req,
    });
    return res.json({ success: true });
  } catch (err) {
    logger.error('[DELETE /insurance/claims/:id]', { error: err });
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
    const claim = await prisma.insuranceClaim.findFirst({
      where: { id, practiceId: practiceIdFromSession(req), deletedAt: null },
    });
    if (!claim) {
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
    logger.error('[POST /insurance/claims/:id/confirm-payment]', { error: err });
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
    const claim = await prisma.insuranceClaim.findFirst({
      where: { id, practiceId: practiceIdFromSession(req), deletedAt: null },
    });
    if (!claim) {
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

    // M-4: apply redaction consistent with all other claim-returning endpoints.
    return res.json({
      success: true,
      data: redactInsuranceClaim(updated as Record<string, unknown>, req.auth),
      recovery: result,
    });
  } catch (err) {
    logger.error('[POST /insurance/claims/:id/resolve-escalation]', { error: err });
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.get('/claims/:id', async (req: Request, res: Response) => {
  try {
    const claim = await prisma.insuranceClaim.findFirst({
      where: {
        id: req.params.id,
        practiceId: practiceIdFromSession(req),
        deletedAt: null,
      },
      include: {
        callAttempts: {
          orderBy: { initiatedAt: 'desc' },
          take: 20,
          select: {
            id: true,
            vapiCallId: true,
            initiatedAt: true,
            completedAt: true,
            durationSeconds: true,
            outcome: true,
            outcomeDetail: true,
            repName: true,
            referenceNumber: true,
            carrierBlockDetected: true,
            validationPassed: true,
            validationResult: true,
          },
        },
        queueEntry: {
          select: {
            id: true,
            status: true,
            attempts: true,
            scheduledFor: true,
            lastAttemptAt: true,
            priority: true,
          },
        },
      },
    });

    if (!claim) {
      return res.status(404).json({ success: false, error: 'Claim not found' });
    }

    return res.json({
      success: true,
      data: redactInsuranceClaim(claim as Record<string, unknown>, req.auth),
    });
  } catch (err) {
    logger.error('[GET /insurance/claims/:id]', { error: err });
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
    logger.error('[GET /insurance/claims/:id/recovery]', { error: err });
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
    logger.error('[POST /insurance/claims/import]', { error: err });
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
    logger.error('[GET /insurance/analytics/denials]', { error: err });
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/insurance/queue/trigger/:claimId
// Manually trigger a call for a specific claim right now.
//
// Respects all safety rules:
//   - CARRIER_BLOCK check
//   - BAAL + provider number + voice agent enabled (via validateDispatch)
//   - Days outstanding rules (< 30 reject, > 90 escalate)
//   - Max 3 attempts
//   - Business hours (Mon–Fri 08:00–17:00 Eastern)
// ---------------------------------------------------------------------------
router.post('/queue/trigger/:claimId', strictLimiter, async (req: Request, res: Response) => {
  try {
    const { claimId } = req.params;

    const claim = await prisma.insuranceClaim.findFirst({
      where: {
        id: claimId,
        practiceId: practiceIdFromSession(req),
        deletedAt: null,
      },
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

    // Validate all dispatch rules (non-race-prone checks: CARRIER_BLOCK,
    // days outstanding, business hours)
    const guard = await validateDispatch(prisma, {
      practiceId,
      claimId,
      carrierId: claim.carrierId,
      daysOutstanding: claim.daysOutstanding,
      attemptsSoFar,
      claimStatus: claim.status,
      scheduledFor: new Date(),
    });

    // Write guardrails audit log (non-blocking)
    try {
      await writeDispatchAudit(claim.id, claim.patientToken, guard, claim.practiceId);
    } catch (err) {
      logger.error('[guardrails] Failed to write dispatch audit:', { error: err });
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
        const reason = 'Claim exceeded 90 days outstanding — escalated for human follow-up';
        const existingEscalation = await prisma.callEscalation.findFirst({
          where: { practiceId, claimId, status: 'open', reason },
          select: { id: true },
        });
        if (!existingEscalation) {
          await createEscalation(prisma, {
            practiceId,
            claimId,
            claimRef: claim.claimNumber,
            carrierId: claim.carrierId,
            amountClaimedCents: Math.round(Number(claim.outstandingAmount) * 100),
            reason,
          });
          try {
            await sendPracticeNotification(prisma, {
              practiceId,
              type: 'CLAIM_AGED_OUT',
              subject: `Claim ${claim.claimNumber}: 90+ days outstanding`,
              message: `This claim has been outstanding over 90 days. Per policy, AI calling has stopped and it has been escalated for human follow-up.`,
              claimId,
              severity: 'warning',
            });
          } catch (notifErr) {
            console.error('[insurance] over-90-day escalation notification failed (non-fatal):', notifErr);
          }
        }
      }
      const statusCode = guard.code === 'SUBSCRIPTION_CLAIM_LIMIT_REACHED' ? 402 : 422;
      return res.status(statusCode).json({ success: false, error: guard.reason, code: guard.code });
    }

    const planGate = await canMakeCall(practiceId);
    if (!planGate.allowed) {
      return res.status(402).json({
        success: false,
        error: gateBlockMessage(planGate.reason, planGate.overageRatePerMinute),
        reason: planGate.reason,
      });
    }

    // Atomically reserve the dispatch slot: lock the claim row, re-verify the
    // attempt count under lock, set status to CALLING, and increment attempts.
    // This eliminates the TOCTOU gap where two concurrent triggers could both
    // pass the < 3 check and both dispatch.
    const reserved = await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        `SELECT id FROM insurance_claims WHERE id = $1 FOR UPDATE`,
        claimId,
      );

      const lockedQueue = await tx.callQueue.findUnique({
        where: { claimId },
        select: {
          attempts: true,
          status: true,
          lastAttemptAt: true,
          dispatchDeferralCode: true,
          dispatchDeferralNextAction: true,
          dispatchDeferredAt: true,
        },
      });
      const lockedClaim = await tx.insuranceClaim.findUnique({
        where: { id: claimId },
        select: { status: true },
      });

      const lockedAttempts = lockedQueue?.attempts ?? claim.callAttempts.length;
      if (lockedAttempts >= 3) {
        return { ok: false as const, reason: `Maximum 3 call attempts reached (${lockedAttempts} so far)` };
      }
      if (lockedClaim?.status === 'CALLING' || lockedQueue?.status === 'IN_PROGRESS') {
        return { ok: false as const, reason: 'A call is already in progress for this claim' };
      }

      await tx.insuranceClaim.update({
        where: { id: claimId },
        data: { status: 'CALLING' },
      });

      await tx.callQueue.upsert({
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
      });

      return {
        ok: true as const,
        reservation: {
          claimStatus: lockedClaim?.status ?? claim.status,
          queue: lockedQueue,
        },
      };
    });

    if (!reserved.ok) {
      return res.status(422).json({ success: false, error: reserved.reason });
    }

    const carrierConfig = CARRIER_CONFIGS[claim.carrierId];

    const [practice, practiceSettings] = await Promise.all([
      prisma.practice.findUnique({
        where: { id: practiceId },
        select: { name: true, billingPhone: true, npi: true, taxId: true },
      }),
      getPracticeSettings(prisma, practiceId),
    ]);
    const carrierSettings = practiceSettings.carrierConfigs.find(
      (c) => c.carrierId === claim.carrierId,
    );

    // ── PHI RESOLUTION ────────────────────────────────────────────────────────
    // Detokenize UUID → real PHI. PHI goes to Vapi as ephemeral call variables
    // only — never stored in DB, never in logs. Token must still be live in
    // piiVault (claim-lifecycle TTL — PHI_VAULT_TTL_DAYS — from import time).
    const phiResult = piiVault.detokenize(claim.patientToken, 'insurance-trigger', {
      practiceId: claim.practiceId,
    });
    if (!phiResult.success || !phiResult.phi) {
      logger.warn?.('[insurance trigger] PHI token expired or missing', {
        claimId,
        patientToken: claim.patientToken,
        error: phiResult.error,
      });
      // Reservation already flipped status to CALLING — release it.
      await prisma.$transaction([
        prisma.insuranceClaim.update({
          where: { id: claimId },
          data: { status: claim.status },
        }),
        prisma.callQueue.update({
          where: { claimId },
          data: { status: 'PENDING', attempts: { decrement: 1 } },
        }),
      ]);
      return res.status(422).json({
        success: false,
        error: 'PHI token has expired — re-import the claim to refresh it',
      });
    }
    logger.audit('PHI_TOKEN_RESOLVED', {
      claimId,
      patientToken: claim.patientToken,
      callerContext: 'insurance-trigger',
      phiBoundary: 'PHI_IN_EPHEMERAL_CALL_VARIABLES_ONLY',
    });
    await appendPhiAccessEvent(prisma, {
      practiceId,
      operation: 'detokenize_for_carrier_call',
      recordType: 'InsuranceClaim',
      recordId: claimId,
      purpose: 'manual_carrier_dispatch',
    });

    // billingPhone is the CRTC disclosure / carrier callback number.
    // escalationPhoneNumber is for staff takeover — do not conflate.
    const practicePhone =
      practice?.billingPhone?.trim() ||
      practiceSettings.billingPhone?.trim() ||
      practiceSettings.escalationPhoneNumber;

    // Build IVR instructions from carrier adapter knowledge base
    const carrierIvrInstructions = carrierConfig.ivrHints.join(' | ');

    // Initiate Vapi call (outside the transaction — no DB lock held during HTTP).
    // PHI injected as ephemeral call variables — never stored, never logged.
    let vapiResult;
    try {
      vapiResult = await vapiClient.initiateCall({
        claimId: claim.id,
        carrierId: claim.carrierId,
        practiceId,
        patientToken: claim.patientToken,
        // ── PHI — from piiVault.detokenize() above; ephemeral, never stored ──────
        patientName:        phiResult.phi.patientName,
        patientDob:         phiResult.phi.dateOfBirth,
        policyNumber:       phiResult.phi.subscriberId,
        groupNumber:        phiResult.phi.groupPolicyNumber,
        subscriberName:     phiResult.phi.subscriberName,
        subscriberDob:      phiResult.phi.subscriberDateOfBirth,
        // ── Claim fields ──────────────────────────────────────────────────────────
        carrierPhone:       carrierConfig.phone,
        claimNumber:        claim.claimNumber,
        billedAmount:       Number(claim.billedAmount),
        outstandingAmount:  Number(claim.outstandingAmount),
        amountExpected:     claim.expectedAmount ? Number(claim.expectedAmount) : undefined,
        daysOutstanding:    claim.daysOutstanding,
        treatmentDate:      claim.servicedAt?.toISOString().split('T')[0],
        claimSubmittedDate: claim.submittedAt?.toISOString().split('T')[0],
        treatmentCodes:     claim.treatmentCodes ?? undefined,
        // ── Practice identity ─────────────────────────────────────────────────────
        practiceName:           practice?.name ?? '',
        practiceNpi:            practice?.npi ?? undefined,
        practiceTaxId:          practice?.taxId ?? undefined,
        providerNumber:         carrierSettings?.providerNumber ?? '',
        practicePhone,
        languagePreference:     carrierSettings?.languagePreference ?? 'en',
        carrierIvrInstructions,
      });
    } catch (vapiErr) {
      // Vapi call failed — release the dispatch slot so the attempt isn't wasted
      await prisma.$transaction([
        prisma.insuranceClaim.update({
          where: { id: claimId },
          data: { status: claim.status },
        }),
        prisma.callQueue.update({
          where: { claimId },
          data: {
            status: 'PENDING',
            attempts: { decrement: 1 },
          },
        }),
      ]);
      throw vapiErr;
    }

    // Only ONE callAttempt.create per dispatch — vapiCallId has @unique constraint.
    // If persistence fails, cancel the external call and restore the exact
    // reservation state atomically so the claim cannot remain falsely CALLING.
    try {
      await prisma.callAttempt.create({
        data: {
          claimId: claim.id,
          vapiCallId: vapiResult.vapiCallId,
          initiatedAt: new Date(),
          liveState: 'dialing',
          activeAgent: 'IVR_Navigator',
        },
      });
    } catch (persistenceError) {
      const { terminationError } = await compensateFailedManualDispatch(prisma, {
        claimId,
        vapiCallId: vapiResult.vapiCallId,
        reservation: reserved.reservation,
        terminateCall: (callId) => vapiClient.endVapiCall(callId),
      });
      logger.error('[POST /insurance/queue/trigger/:claimId] post-dispatch persistence failed', {
        claimId,
        vapiCallId: vapiResult.vapiCallId,
        persistenceError,
        terminationError,
      });
      throw persistenceError;
    }

    return res.json({
      success: true,
      vapiCallId: vapiResult.vapiCallId,
      status: vapiResult.status,
    });
  } catch (err) {
    logger.error('[POST /insurance/queue/trigger/:claimId]', { error: err });
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
    logger.error('[GET /insurance/queue]', { error: err });
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
    logger.error('[GET /insurance/recovery/gates]', { error: err });
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
    logger.error('[GET /insurance/recovery/metrics]', { error: err });
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
    logger.error('[GET /insurance/recovery/notifications]', { error: err });
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/insurance/practice-notifications — validation escalations + system alerts
// ---------------------------------------------------------------------------
router.get('/practice-notifications', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const notifications = await prisma.practiceNotification.findMany({
      where: { practiceId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return res.json({ success: true, data: notifications });
  } catch (err) {
    logger.error('[GET /insurance/practice-notifications]', { error: err });
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/insurance/practice-notifications/:id/read — mark as read
// ---------------------------------------------------------------------------
router.patch('/practice-notifications/:id/read', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const notification = await prisma.practiceNotification.updateMany({
      where: { id: req.params.id, practiceId },
      data: { readAt: new Date() },
    });
    return res.json({ success: true, modified: notification.count });
  } catch (err) {
    logger.error('[PATCH /insurance/practice-notifications/:id/read]', { error: err });
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

// ---------------------------------------------------------------------------
// CSV-first denial, evidence, and underpayment operations. These records are
// practice-scoped operational metadata; clinical attachments remain in the PMS.
// ---------------------------------------------------------------------------
router.get('/denials', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const data = await prisma.claimRecoveryAction.findMany({
      where: {
        practiceId,
        status: { in: ['OPEN', 'BLOCKING'] },
        actionType: { in: ['DENIAL_REVIEW', 'PRACTICE_DOCS', 'PRACTICE_RESUBMIT', 'HUMAN_ESCALATION'] },
      },
      include: {
        claim: {
          select: {
            claimNumber: true, carrierId: true, outstandingAmount: true,
            denialReasonCode: true, denialReasonText: true, appealDeadline: true,
          },
        },
      },
      orderBy: [{ deadline: 'asc' }, { createdAt: 'asc' }],
    });
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.get('/claims/:id/evidence', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    if (!(await isCsvArFeatureEnabled(prisma, practiceId, CSV_AR_FEATURES.DENIAL_HUB))) {
      return res.status(403).json({ success: false, error: 'Denial hub is disabled for this practice' });
    }
    const claim = await prisma.insuranceClaim.findFirst({
      where: { id: req.params.id, practiceId, deletedAt: null },
      select: { id: true },
    });
    if (!claim) return res.status(404).json({ success: false, error: 'Claim not found' });
    const [items, submissions, exports] = await Promise.all([
      prisma.claimEvidenceItem.findMany({ where: { claimId: claim.id, practiceId }, orderBy: { createdAt: 'asc' } }),
      prisma.claimSubmission.findMany({ where: { claimId: claim.id, practiceId }, orderBy: { submittedAt: 'desc' } }),
      prisma.evidencePackExport.findMany({ where: { claimId: claim.id, practiceId }, orderBy: { createdAt: 'desc' } }),
    ]);
    return res.json({ success: true, data: { items, submissions, exports } });
  } catch (err) {
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.post('/claims/:id/evidence/:evidenceType/attest', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    if (!(await isCsvArFeatureEnabled(prisma, practiceId, CSV_AR_FEATURES.DENIAL_HUB))) {
      return res.status(403).json({ success: false, error: 'Denial hub is disabled for this practice' });
    }
    const claim = await prisma.insuranceClaim.findFirst({ where: { id: req.params.id, practiceId, deletedAt: null } });
    if (!claim) return res.status(404).json({ success: false, error: 'Claim not found' });
    const evidenceType = req.params.evidenceType.trim().slice(0, 80);
    if (!evidenceType) return res.status(400).json({ success: false, error: 'evidence type required' });
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : null;
    const existing = await prisma.claimEvidenceItem.findFirst({
      where: { practiceId, claimId: claim.id, recoveryActionId: null, evidenceType },
      select: { id: true },
    });
    const item = existing
      ? await prisma.claimEvidenceItem.update({
          where: { id: existing.id },
          data: { status: 'ATTESTED', attestedAt: new Date(), note },
        })
      : await prisma.claimEvidenceItem.create({
          data: { practiceId, claimId: claim.id, evidenceType, status: 'ATTESTED', attestedAt: new Date(), note },
        });
    await appendAuditLog(prisma, { practiceId, action: 'claim.evidence.attest', subjectType: 'InsuranceClaim', subjectId: claim.id, req });
    return res.json({ success: true, data: item });
  } catch (err) {
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.post('/claims/:id/submissions', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    if (!(await isCsvArFeatureEnabled(prisma, practiceId, CSV_AR_FEATURES.DENIAL_HUB))) {
      return res.status(403).json({ success: false, error: 'Denial hub is disabled for this practice' });
    }
    const claim = await prisma.insuranceClaim.findFirst({ where: { id: req.params.id, practiceId, deletedAt: null } });
    if (!claim) return res.status(404).json({ success: false, error: 'Claim not found' });
    const method = typeof req.body?.method === 'string' ? req.body.method.trim().slice(0, 80) : '';
    if (!method) return res.status(400).json({ success: false, error: 'submission method required' });
    const submission = await prisma.claimSubmission.create({
      data: {
        practiceId, claimId: claim.id, method,
        referenceNumber: typeof req.body?.referenceNumber === 'string' ? req.body.referenceNumber.trim().slice(0, 120) : null,
        submittedBy: typeof req.body?.submittedBy === 'string' ? req.body.submittedBy.trim().slice(0, 120) : null,
        note: typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : null,
      },
    });
    await prisma.claimRecoveryEvent.create({
      data: { practiceId, claimId: claim.id, eventType: 'CARRIER_SUBMISSION_RECORDED', metadata: { method, referenceNumber: submission.referenceNumber } },
    });
    return res.json({ success: true, data: submission });
  } catch (err) {
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.get('/claims/:id/evidence-pack', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    if (!(await isCsvArFeatureEnabled(prisma, practiceId, CSV_AR_FEATURES.DENIAL_HUB))) {
      return res.status(403).json({ success: false, error: 'Denial hub is disabled for this practice' });
    }
    const claim = await prisma.insuranceClaim.findFirst({
      where: { id: req.params.id, practiceId, deletedAt: null },
      select: {
        id: true, claimNumber: true, carrierId: true, outstandingAmount: true, expectedAmount: true,
        denialReasonCode: true, denialReasonText: true, appealDeadline: true, recoveryActions: { select: { actionType: true, status: true, title: true, deadline: true } },
      },
    });
    if (!claim) return res.status(404).json({ success: false, error: 'Claim not found' });
    const [evidence, submissions, events] = await Promise.all([
      prisma.claimEvidenceItem.findMany({ where: { claimId: claim.id, practiceId }, select: { evidenceType: true, status: true, attestedAt: true } }),
      prisma.claimSubmission.findMany({ where: { claimId: claim.id, practiceId }, select: { method: true, referenceNumber: true, submittedAt: true } }),
      prisma.claimRecoveryEvent.findMany({ where: { claimId: claim.id, practiceId }, orderBy: { createdAt: 'asc' }, select: { eventType: true, createdAt: true } }),
    ]);
    const pack = { generatedAt: new Date().toISOString(), claim, evidence, submissions, events };
    const { createHash } = await import('node:crypto');
    const checksum = createHash('sha256').update(JSON.stringify(pack)).digest('hex');
    await prisma.evidencePackExport.create({ data: { practiceId, claimId: claim.id, checksum, format: 'JSON' } });
    return res.json({ success: true, data: pack, checksum });
  } catch (err) {
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.post('/claims/:id/underpayments', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const claim = await prisma.insuranceClaim.findFirst({ where: { id: req.params.id, practiceId, deletedAt: null } });
    if (!claim) return res.status(404).json({ success: false, error: 'Claim not found' });
    const paidCents = Number(req.body?.paidCents);
    const expectedCents = Number(req.body?.expectedCents ?? Math.round(Number(claim.expectedAmount ?? 0) * 100));
    if (!Number.isInteger(paidCents) || !Number.isInteger(expectedCents) || paidCents < 0 || expectedCents <= paidCents) {
      return res.status(400).json({ success: false, error: 'paidCents must be below expectedCents' });
    }
    const data = await prisma.underpaymentCase.upsert({
      where: { claimId_expectedCents_paidCents: { claimId: claim.id, expectedCents, paidCents } },
      create: { practiceId, claimId: claim.id, expectedCents, paidCents, varianceCents: expectedCents - paidCents, reasonCode: typeof req.body?.reasonCode === 'string' ? req.body.reasonCode.slice(0, 80) : null },
      update: { status: 'OPEN' },
    });
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.get('/underpayments', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const data = await prisma.underpaymentCase.findMany({
      where: { practiceId, status: 'OPEN' },
      include: { claim: { select: { claimNumber: true, carrierId: true, outstandingAmount: true } } },
      orderBy: { varianceCents: 'desc' },
    });
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.get('/carrier-intelligence/feed', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const { getPracticeCarrierIntelligenceFeed } = await import('../server/learning/practiceCarrierFeed.js');
    const data = await getPracticeCarrierIntelligenceFeed(prisma, practiceId);
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.get('/claims/:id/submission-quality', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const { evaluateSubmissionQuality } = await import('../server/reconciliation/submissionQualityGate.js');
    const data = await evaluateSubmissionQuality(prisma, practiceId, req.params.id);
    return res.json({ success: true, data });
  } catch (err) {
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
    logger.error('[GET /insurance/claims/:id/route-explanation]', { error: err });
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
