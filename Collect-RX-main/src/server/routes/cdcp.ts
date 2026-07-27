/**
 * Phase 5: CDCP Reconsideration API Routes
 *
 * POST   /api/cdcp/denied-claims           — Ingest denied CDCP claims from Abeldent sync
 * POST   /api/cdcp/reconsiderations        — Create a reconsideration record
 * GET    /api/cdcp/reconsiderations        — List reconsiderations for a practice
 * GET    /api/cdcp/reconsiderations/:id    — Get reconsideration detail
 * PATCH  /api/cdcp/reconsiderations/:id    — Update status (submitted, approved, denied_final)
 * POST   /api/cdcp/evidence-gap           — Analyze evidence gaps for a claim
 * POST   /api/cdcp/submission-strategy    — Get CDAnet vs paper fallback recommendation
 * GET    /api/cdcp/queue                  — Get triaged reconsideration queue (sorted by urgency)
 * GET    /api/cdcp/kpi                    — Get Phase 5 KPI snapshot for a practice
 * POST   /api/cdcp/kpi                    — Upsert KPI snapshot
 * GET    /api/cdcp/fee-ceiling            — Get CDCP fee ceiling for a province and base fee
 */

import { Router, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { useOwnerPracticeApiAuthOnly } from '../middleware/ownerPracticeApi.js';
import { blockAuditorWrites } from '../middleware/requireUserRole.js';
import {
  analyzeEvidenceGap,
} from '../services/cdcp/evidenceMapper.js';
import {
  selectSubmissionStrategy,
} from '../services/cdcp/cdanetSubmission.js';
import {
  getCdcpFeeCeiling,
  apply2026FeeGuide,
} from '../services/carrierRules.js';
import type { CdcpDeniedClaim } from '../services/cdcp/types.js';

export function createCdcpRouter(prisma: PrismaClient): Router {
  const router = Router();

  useOwnerPracticeApiAuthOnly(router);

  // ── POST /api/cdcp/denied-claims ────────────────────────────────────────────
  // Called by Abeldent sync when Transaction 11 denials are detected
  router.post('/denied-claims', blockAuditorWrites, async (req: Request, res: Response) => {
    try {
      const { claims } = req.body as { claims: CdcpDeniedClaim[] };

      if (!Array.isArray(claims) || claims.length === 0) {
        return res.status(400).json({ error: 'claims array required' });
      }

      const practiceId = req.practiceAuth?.practiceId;
      if (!practiceId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { ingestCdcpDeniedClaimsToPrisma } = await import('../recovery/cdcpPrismaQueue.js');
      const result = await ingestCdcpDeniedClaimsToPrisma(prisma, practiceId, claims);

      res.json({
        processed: result.processed,
        newReconsiderations: result.newReconsiderations,
        urgentEscalations: result.urgentClaimIds.length,
        urgentClaimIds: result.urgentClaimIds,
      });
    } catch (err) {
      console.error('[CDCP] /denied-claims error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── GET /api/cdcp/queue ─────────────────────────────────────────────────────
  router.get('/queue', async (req: Request, res: Response) => {
    try {
      const practiceId = req.practiceAuth?.practiceId;
      if (!practiceId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { listCdcpQueueFromPrisma } = await import('../recovery/cdcpPrismaQueue.js');
      const result = await listCdcpQueueFromPrisma(prisma, practiceId);
      res.json(result);
    } catch (err) {
      console.error('[CDCP] /queue error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── POST /api/cdcp/evidence-gap ─────────────────────────────────────────────
  router.post('/evidence-gap', (req: Request, res: Response) => {
    try {
      const { claimId, cdtCode, denialReasonCode, availableEvidenceTypes, scalingUnitsRequested } = req.body;

      if (!claimId || !cdtCode || !denialReasonCode) {
        return res.status(400).json({ error: 'claimId, cdtCode, and denialReasonCode required' });
      }

      const gap = analyzeEvidenceGap({
        claimId,
        cdtCode,
        denialReasonCode,
        availableEvidenceTypes: availableEvidenceTypes ?? [],
        scalingUnitsRequested,
      });

      res.json(gap);
    } catch (err) {
      console.error('[CDCP] /evidence-gap error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── POST /api/cdcp/submission-strategy ─────────────────────────────────────
  router.post('/submission-strategy', (req: Request, res: Response) => {
    try {
      const { pmsCapability } = req.body as { pmsCapability: 'cdanet_v4' | 'cdanet_v3_legacy' | 'no_cdanet' };

      if (!pmsCapability) {
        return res.status(400).json({ error: 'pmsCapability required' });
      }

      const strategy = selectSubmissionStrategy(pmsCapability);
      res.json(strategy);
    } catch (err) {
      console.error('[CDCP] /submission-strategy error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── PATCH /api/cdcp/reconsiderations/:id ────────────────────────────────────
  router.patch('/reconsiderations/:id', blockAuditorWrites, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status, assignedAdjudicatorId, confirmationNumber, notes, submissionMethod } = req.body;
      const practiceId = req.practiceAuth?.practiceId;
      if (!practiceId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { patchCdcpReconsiderationCase } = await import('../recovery/cdcpPrismaQueue.js');
      const result = await patchCdcpReconsiderationCase(prisma, practiceId, id, {
        status,
        assignedAdjudicatorId,
        confirmationNumber,
        notes,
        submissionMethod,
      });

      if (!result.ok) {
        return res.status(result.httpStatus).json({ error: result.error });
      }

      res.json({ success: true });
    } catch (err) {
      console.error('[CDCP] PATCH /reconsiderations error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── GET /api/cdcp/fee-ceiling ───────────────────────────────────────────────
  router.get('/fee-ceiling', (req: Request, res: Response) => {
    try {
      const { baseFee, province } = req.query as { baseFee: string; province: string };

      if (!baseFee || !province) {
        return res.status(400).json({ error: 'baseFee and province required' });
      }

      const base = parseFloat(baseFee);
      if (isNaN(base) || base <= 0) {
        return res.status(400).json({ error: 'baseFee must be a positive number' });
      }

      const fee2026 = apply2026FeeGuide(base, province);
      const ceiling = getCdcpFeeCeiling(base, province);

      res.json({
        baseFee: base,
        province,
        fee2026: Math.round(fee2026 * 100) / 100,
        cdcpCeiling: Math.round(ceiling * 100) / 100,
        balanceBillingProhibitedAbove: Math.round(ceiling * 100) / 100,
      });
    } catch (err) {
      console.error('[CDCP] /fee-ceiling error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── GET /api/cdcp/reconsiderations ─────────────────────────────────────────
  router.get('/reconsiderations', async (req: Request, res: Response) => {
    try {
      const practiceId = req.practiceAuth?.practiceId;
      if (!practiceId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { status, limit, offset } = req.query as { status?: string; limit?: string; offset?: string };
      const take = Math.min(100, Math.max(1, Number(limit) || 50));
      const skip = Math.max(0, Number(offset) || 0);

      const where: Record<string, unknown> = { practiceId };
      if (status) {
        where.status = status;
      }

      const [total, cases] = await Promise.all([
        prisma.cdcpReconsiderationCase.count({ where }),
        prisma.cdcpReconsiderationCase.findMany({
          where,
          orderBy: { denialDate: 'desc' },
          take,
          skip,
        }),
      ]);

      res.json({ total, cases, limit: take, offset: skip });
    } catch (err) {
      console.error('[CDCP] GET /reconsiderations error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── GET /api/cdcp/reconsiderations/:id ──────────────────────────────────────
  router.get('/reconsiderations/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const practiceId = req.practiceAuth?.practiceId;
      if (!practiceId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const caseRecord = await prisma.cdcpReconsiderationCase.findFirst({
        where: { id, practiceId },
      });

      if (!caseRecord) {
        return res.status(404).json({ error: 'Reconsideration not found' });
      }

      res.json({ case: caseRecord });
    } catch (err) {
      console.error('[CDCP] GET /reconsiderations/:id error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── POST /api/cdcp/reconsiderations ─────────────────────────────────────────
  router.post('/reconsiderations', blockAuditorWrites, async (req: Request, res: Response) => {
    try {
      const practiceId = req.practiceAuth?.practiceId;
      if (!practiceId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const {
        patientToken,
        claimRef,
        carrierCode,
        procedureCode,
        denialDate,
        clinicalEvidenceSummary,
        originalAdjudicatorHint,
      } = req.body;

      if (!patientToken || !claimRef || !denialDate) {
        return res.status(400).json({ error: 'patientToken, claimRef, and denialDate required' });
      }

      const caseRecord = await prisma.cdcpReconsiderationCase.create({
        data: {
          practiceId,
          patientToken,
          claimRef,
          carrierCode: carrierCode || 'cdcp_generic',
          procedureCode: procedureCode || null,
          denialDate: new Date(denialDate),
          status: 'open',
          clinicalEvidenceSummary: clinicalEvidenceSummary || null,
          originalAdjudicatorHint: originalAdjudicatorHint || null,
        },
      });

      res.status(201).json({ case: caseRecord });
    } catch (err) {
      console.error('[CDCP] POST /reconsiderations error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── GET /api/cdcp/kpi ───────────────────────────────────────────────────────
  router.get('/kpi', async (req: Request, res: Response) => {
    try {
      const practiceId = req.practiceAuth?.practiceId;
      const { date } = req.query as { date?: string };
      const snapshotDate = date ?? new Date().toISOString().slice(0, 10);

      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT * FROM phase5_kpi_snapshots
        WHERE practice_id = ${practiceId}::integer
          AND snapshot_date <= ${snapshotDate}::date
        ORDER BY snapshot_date DESC
        LIMIT 10
      `;

      res.json({ snapshots: rows });
    } catch (err) {
      console.error('[CDCP] GET /kpi error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── POST /api/cdcp/kpi ──────────────────────────────────────────────────────
  router.post('/kpi', blockAuditorWrites, async (req: Request, res: Response) => {
    try {
      const practiceId = req.practiceAuth?.practiceId;
      if (!practiceId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { snapshotDate, metrics } = req.body as {
        snapshotDate?: string;
        metrics?: Record<string, unknown>;
      };

      if (!snapshotDate || !metrics || typeof metrics !== 'object') {
        return res.status(400).json({ error: 'snapshotDate and metrics object required' });
      }

      const result = await prisma.$executeRaw`
        INSERT INTO phase5_kpi_snapshots (practice_id, snapshot_date, metrics, created_at)
        VALUES (${parseInt(practiceId, 10)}, ${snapshotDate}::date, ${JSON.stringify(metrics)}::jsonb, NOW())
        ON CONFLICT (practice_id, snapshot_date) DO UPDATE
        SET metrics = ${JSON.stringify(metrics)}::jsonb, created_at = NOW()
      `;

      res.json({ ok: true, result });
    } catch (err) {
      console.error('[CDCP] POST /kpi error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
