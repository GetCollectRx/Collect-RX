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
  ReconcileRequest,
  ReconcileResponse,
  StatusResponse,
} from '../services/eligibility/types';

// ---------------------------------------------------------------------------
// In this implementation the route layer delegates all heavy logic to the
// engine and reconciliation services.  Database persistence (snapshots,
// estimates, reconciliation logs) is assumed to be handled by the calling
// application or a repository layer injected at startup.
// ---------------------------------------------------------------------------

const router = Router();

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

    const estimate = generateEstimate(estimateRequest, body.patient as ReturnType<typeof generateEstimate> extends ReturnType<typeof generateEstimate> ? any : any);

    const response: EstimateResponse = { success: true, estimate };
    return res.status(200).json(response);
  } catch (err) {
    console.error('[eligibility/estimate]', err);
    return res.status(500).json({
      success: false,
      error: (err as Error).message ?? 'Internal server error',
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

    // TODO: replace with actual DB query when repository layer is wired in
    // Example: const snapshot = await EligibilitySnapshotRepo.findLatest(patientId, carrier);
    const snapshot = (req as any).db
      ? await (req as any).db.query(
          `SELECT * FROM eligibility_snapshots WHERE patient_id = $1 AND carrier = $2 ORDER BY verified_at DESC LIMIT 1`,
          [patientId, carrier],
        ).then((r: any) => r.rows[0] ?? null)
      : null;

    const response: StatusResponse = { success: true, snapshot: snapshot ?? undefined };
    return res.status(200).json(response);
  } catch (err) {
    console.error('[eligibility/status]', err);
    return res.status(500).json({ success: false, error: (err as Error).message });
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

    const result = reconcile(body.estimate as any, body.adjudication);

    // TODO: persist reconciliation result to DB
    // await ReconciliationRepo.save(result);

    const response: ReconcileResponse = { success: true, result };
    return res.status(200).json(response);
  } catch (err) {
    console.error('[eligibility/reconcile]', err);
    return res.status(500).json({ success: false, error: (err as Error).message });
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
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
});

export default router;
