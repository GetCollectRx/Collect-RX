// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Eligibility Express Routes
// POST /api/eligibility/estimate
// GET  /api/eligibility/status/:patientId/:carrier
// POST /api/eligibility/reconcile
// POST /api/eligibility/telus-tpa
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import { generateEstimate, identifyTelusPlan } from '../services/eligibility/engine';
import { reconcile } from '../services/eligibility/reconciliation';
import {
  Carrier,
  EstimateRequest,
  EstimateResponse,
  EligibilityEstimate,
  EligibilitySnapshot,
  EligibilityStatus,
  Patient,
  ReconcileRequest,
  ReconcileResponse,
  StatusResponse,
} from '../services/eligibility/types';
import { prisma } from '../lib/prisma';
import type { CarrierId } from '@prisma/client';
import { practiceIdFromSession } from '../server/middleware/requirePracticeSession';
import { useOwnerPracticeApiAuthOnly } from '../server/middleware/ownerPracticeApi.js';
import { apiErrorMessageForResponse } from '../server/apiErrorMessage.js';

// ---------------------------------------------------------------------------
// Engine + reconciliation; snapshots and reconcile results persist via Prisma.
// All routes require a practice session (JWT cookie or Bearer token).
// EligibilitySnapshot is scoped by practiceId (see prisma migration eligibility_snapshot_practice_id).
// ---------------------------------------------------------------------------

const router = Router();
useOwnerPracticeApiAuthOnly(router);

type EligibilitySnapshotRow = NonNullable<Awaited<ReturnType<typeof prisma.eligibilitySnapshot.findFirst>>>;

function mapEligibilitySnapshotFromDb(row: EligibilitySnapshotRow): EligibilitySnapshot {
  const raw = row.rawCarrierResponse;
  const rawCarrierResponse =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;

  return {
    snapshotId: row.snapshotId,
    patientId: row.patientId,
    carrier: row.carrier as Carrier,
    status: row.status as EligibilityStatus,
    verifiedAt: row.verifiedAt.toISOString(),
    deductibleIndividualMet: Number(row.deductibleIndividualMet),
    deductibleFamilyMet: Number(row.deductibleFamilyMet),
    annualMaxUsedIndividual: Number(row.annualMaxUsedIndividual),
    annualMaxUsedFamily: row.annualMaxUsedFamily != null ? Number(row.annualMaxUsedFamily) : null,
    planYearStart: row.planYearStart.toISOString().slice(0, 10),
    rawCarrierResponse,
  };
}

// ---------------------------------------------------------------------------
// POST /api/eligibility/estimate
// Generate a pre-treatment eligibility estimate.
//
// Body: EstimateRequest + patient object
// Returns: EstimateResponse
// ---------------------------------------------------------------------------
router.post('/estimate', async (req: Request, res: Response) => {
  try {
    const body = req.body as EstimateRequest & { patient: unknown };

    // Basic validation
    if (!body.patientId) {
      return res.status(400).json({ success: false, error: 'patientId is required' });
    }
    if (!body.carrier || !Object.values(Carrier).includes(body.carrier as Carrier)) {
      return res.status(400).json({
        success: false,
        error: `carrier is required. Valid values: ${Object.values(Carrier).join(', ')}`,
      });
    }
    if (!Array.isArray(body.procedures) || body.procedures.length === 0) {
      return res.status(400).json({ success: false, error: 'procedures array is required and must not be empty' });
    }
    if (!body.patient) {
      return res.status(400).json({ success: false, error: 'patient object is required' });
    }

    // Validate CDT codes
    for (const proc of body.procedures) {
      if (!proc.cdtCode || !/^D\d{4}$/i.test(proc.cdtCode)) {
        return res.status(400).json({
          success: false,
          error: `Invalid CDT code: "${proc.cdtCode}". Must be in format D#### (e.g. D2740).`,
        });
      }
      if (!proc.providerFee || proc.providerFee <= 0) {
        return res.status(400).json({
          success: false,
          error: `providerFee must be > 0 for CDT code ${proc.cdtCode}`,
        });
      }
    }

    const estimateRequest: EstimateRequest = {
      patientId: body.patientId,
      procedures: body.procedures,
      carrier: body.carrier as Carrier,
      eligibilitySnapshot: body.eligibilitySnapshot,
      secondaryCarrier: body.secondaryCarrier,
      secondaryEligibilitySnapshot: body.secondaryEligibilitySnapshot,
    };

    const estimate = generateEstimate(estimateRequest, body.patient as Patient);

    const response: EstimateResponse = { success: true, estimate };
    return res.status(200).json(response);
  } catch (err) {
    console.error('[eligibility/estimate]', err);
    return res.status(500).json({
      success: false,
      error: apiErrorMessageForResponse(err),
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/eligibility/status/:patientId/:carrier
// Return the most recent eligibility snapshot for a patient + carrier.
// (Snapshot is fetched from the database by the repository layer)
// ---------------------------------------------------------------------------
router.get('/status/:patientId/:carrier', async (req: Request, res: Response) => {
  try {
    const { patientId, carrier } = req.params;

    if (!Object.values(Carrier).includes(carrier as Carrier)) {
      return res.status(400).json({
        success: false,
        error: `Unknown carrier: ${carrier}. Valid values: ${Object.values(Carrier).join(', ')}`,
      });
    }

    const practiceId = practiceIdFromSession(req);
    const snapshot = await prisma.eligibilitySnapshot.findFirst({
      where: {
        practiceId,
        patientId,
        carrier: carrier as CarrierId,
      },
      orderBy: { verifiedAt: 'desc' },
    });

    const response: StatusResponse = {
      success: true,
      snapshot: snapshot ? mapEligibilitySnapshotFromDb(snapshot) : undefined,
    };
    return res.status(200).json(response);
  } catch (err) {
    console.error('[eligibility/status]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/eligibility/reconcile
// Compare an estimate against an actual adjudication (EOB).
// ---------------------------------------------------------------------------
router.post('/reconcile', async (req: Request, res: Response) => {
  try {
    const body = req.body as ReconcileRequest & { estimate: unknown };

    if (!body.estimateId) {
      return res.status(400).json({ success: false, error: 'estimateId is required' });
    }
    if (!body.adjudication) {
      return res.status(400).json({ success: false, error: 'adjudication object is required' });
    }
    if (!body.estimate) {
      return res.status(400).json({ success: false, error: 'estimate object is required (pass the original estimate returned by /estimate)' });
    }

    const estimate = body.estimate as EligibilityEstimate;
    const result = reconcile(estimate, body.adjudication);

    const extra = body as ReconcileRequest & { practiceId?: string; claimId?: string };
    await prisma.eligibilityReconcileLog.create({
      data: {
        patientId: estimate.patientId,
        estimateId: body.estimateId,
        claimId: extra.claimId ?? null,
        practiceId: practiceIdFromSession(req),
        adjudicationJson: body.adjudication as object,
        resultJson: result as unknown as object,
      },
    });

    const response: ReconcileResponse = { success: true, result };
    return res.status(200).json(response);
  } catch (err) {
    console.error('[eligibility/reconcile]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/eligibility/telus-tpa
// Identify the underlying TPA for a TELUS AdjudiCare member.
// Called by the IVR Navigator agent before routing a TELUS call.
// ---------------------------------------------------------------------------
router.post('/telus-tpa', async (req: Request, res: Response) => {
  try {
    const { memberId, groupNumber } = req.body as { memberId: string; groupNumber: string };

    if (!memberId || !groupNumber) {
      return res.status(400).json({
        success: false,
        error: 'memberId and groupNumber are required',
      });
    }

    const identification = identifyTelusPlan(memberId, groupNumber);
    return res.status(200).json({ success: true, identification });
  } catch (err) {
    console.error('[eligibility/telus-tpa]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

export default router;
