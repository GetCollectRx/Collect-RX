// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Eligibility Express Routes
// POST /api/eligibility/estimate
// GET  /api/eligibility/status/:patientId/:carrier
// POST /api/eligibility/reconcile
// GET  /api/eligibility/reconcile/history/:estimateId
// POST /api/eligibility/telus-tpa
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import type { Prisma, PrismaClient } from '@prisma/client';
import { generateEstimate, identifyTelusPlan } from '../services/eligibility/engine';
import { reconcile } from '../services/eligibility/reconciliation';
import {
  Carrier,
  EligibilityEstimate,
  EstimateRequest,
  EstimateResponse,
  ReconcileRequest,
  ReconcileResponse,
  StatusResponse,
} from '../services/eligibility/types';

export function createEligibilityRouter(prisma: PrismaClient) {
  const router = Router();

  router.post('/estimate', async (req: Request, res: Response) => {
    try {
      const body = req.body as EstimateRequest & { patient: unknown; practiceId?: string };

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

      const estimate = generateEstimate(estimateRequest, body.patient as any);

      const auth = (req as Request & { practiceAuth?: { practiceId: string } }).practiceAuth;
      const requestJson = {
        patientId: body.patientId,
        procedures: body.procedures,
        carrier: body.carrier,
        practiceId: body.practiceId ?? auth?.practiceId ?? null,
      } as unknown as Prisma.InputJsonValue;
      const resultJson = { estimate } as unknown as Prisma.InputJsonValue;
      try {
        await prisma.eligibilityEstimateLog.create({
          data: {
            practiceId: body.practiceId ?? auth?.practiceId ?? null,
            patientId: body.patientId,
            carrier: String(body.carrier),
            requestJson,
            resultJson,
          },
        });
      } catch (e) {
        console.error('[eligibility/estimate] log persist failed', e);
      }

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

  router.get('/status/:patientId/:carrier', async (req: Request, res: Response) => {
    try {
      const { patientId, carrier } = req.params;

      if (!Object.values(Carrier).includes(carrier as Carrier)) {
        return res.status(400).json({
          success: false,
          error: `Unknown carrier: ${carrier}. Valid values: ${Object.values(Carrier).join(', ')}`,
        });
      }

      const row = await prisma.eligibilityEstimateLog.findFirst({
        where: { patientId, carrier },
        orderBy: { createdAt: 'desc' },
      });
      const raw = row?.resultJson as { estimate?: EligibilityEstimate } | null | undefined;
      const lastEstimate = raw?.estimate;

      const response: StatusResponse = { success: true, lastEstimate };
      return res.status(200).json(response);
    } catch (err) {
      console.error('[eligibility/status]', err);
      return res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  router.post('/reconcile', async (req: Request, res: Response) => {
    try {
      const body = req.body as ReconcileRequest & { estimate: unknown; practiceId?: string };

      if (!body.estimateId) {
        return res.status(400).json({ success: false, error: 'estimateId is required' });
      }
      if (!body.adjudication) {
        return res.status(400).json({ success: false, error: 'adjudication object is required' });
      }
      if (!body.estimate) {
        return res
          .status(400)
          .json({ success: false, error: 'estimate object is required (pass the original estimate returned by /estimate)' });
      }

      const result = reconcile(body.estimate as any, body.adjudication);

      const est = body.estimate as EligibilityEstimate;
      const auth = (req as Request & { practiceAuth?: { practiceId: string } }).practiceAuth;
      const practiceId = body.practiceId ?? auth?.practiceId ?? null;
      const adjudicationJson = body.adjudication as unknown as Prisma.InputJsonValue;
      const resultJson = result as unknown as Prisma.InputJsonValue;
      try {
        await prisma.eligibilityReconcileLog.create({
          data: {
            practiceId,
            patientId: est.patientId ?? body.adjudication.patientId,
            estimateId: body.estimateId,
            claimId: body.adjudication.claimId,
            adjudicationJson,
            resultJson,
          },
        });
      } catch (e) {
        console.error('[eligibility/reconcile] log persist failed', e);
      }

      const response: ReconcileResponse = { success: true, result };
      return res.status(200).json(response);
    } catch (err) {
      console.error('[eligibility/reconcile]', err);
      return res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  /**
   * P3-42 — list persisted reconciliation runs for an estimate (newest first) for side-by-side compare.
   */
  router.get('/reconcile/history/:estimateId', async (req: Request, res: Response) => {
    try {
      const { estimateId } = req.params;
      if (!estimateId) {
        return res.status(400).json({ success: false, error: 'estimateId is required' });
      }
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
      const runs = await prisma.eligibilityReconcileLog.findMany({
        where: { estimateId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          createdAt: true,
          patientId: true,
          estimateId: true,
          claimId: true,
          adjudicationJson: true,
          resultJson: true,
        },
      });
      return res.status(200).json({ success: true, runs });
    } catch (err) {
      console.error('[eligibility/reconcile/history]', err);
      return res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

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

  return router;
}
