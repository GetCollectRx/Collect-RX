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
import { authenticate } from '../middleware/authenticate.js';
import {
  validateAdjudicatorRotation,
  triageReconsiderationQueue,
  processAbeldentSyncDenials,
} from '../services/cdcp/reconsiderationEngine.js';
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
import type { CdcpDeniedClaim, ReconsiderationRecord, CdcpDenialReasonCode, ReconsiderationStatus, EvidenceChecklistItem } from '../services/cdcp/types.js';

function generateId(): string {
  return crypto.randomUUID();
}

export function createCdcpRouter(prisma: PrismaClient): Router {
  const router = Router();

  // All CDCP routes require authentication
  router.use(authenticate);

  // ── POST /api/cdcp/denied-claims ────────────────────────────────────────────
  // Called by Abeldent sync when Transaction 11 denials are detected
  router.post('/denied-claims', async (req: Request, res: Response) => {
    try {
      const { claims } = req.body as { claims: CdcpDeniedClaim[] };

      if (!Array.isArray(claims) || claims.length === 0) {
        return res.status(400).json({ error: 'claims array required' });
      }

      // Get existing reconsideration claim IDs for this practice
      const practiceId = req.practiceAuth?.practiceId;
      const existing = await prisma.$queryRaw<{ claim_id: string }[]>`
        SELECT claim_id FROM cdcp_reconsiderations WHERE practice_id = ${practiceId}::uuid
      `;
      const existingIds = new Set<string>(existing.map((r: { claim_id: string }) => r.claim_id));

      const result = processAbeldentSyncDenials(
        claims.filter(c => c.practiceId === practiceId),
        existingIds,
        generateId
      );

      // Persist new reconsideration records
      if (result.newReconsiderations.length > 0) {
        for (const rec of result.newReconsiderations) {
          await prisma.$executeRaw`
            INSERT INTO cdcp_denied_claims
              (id, claim_id, patient_token, practice_id, cdt_code, cda_code,
               denial_reason_code, denial_date, original_adjudicator_id,
               procedure_fee_cents, province, transaction_type)
            VALUES
              (${rec.id}::uuid, ${rec.claimId}, ${rec.patientToken}::uuid,
               ${rec.practiceId}::uuid,
               ${claims.find(c => c.claimId === rec.claimId)?.cdtCode ?? ''},
               ${claims.find(c => c.claimId === rec.claimId)?.cdaCode ?? null},
               ${rec.denialReasonCode}, ${rec.denialDate}::date,
               ${rec.originalAdjudicatorId ?? null},
               ${Math.round((claims.find(c => c.claimId === rec.claimId)?.procedureFee ?? 0) * 100)},
               ${claims.find(c => c.claimId === rec.claimId)?.province ?? ''},
               'T11')
            ON CONFLICT (claim_id) DO NOTHING
          `;

          await prisma.$executeRaw`
            INSERT INTO cdcp_reconsiderations
              (id, claim_id, patient_token, practice_id, denial_reason_code,
               denial_date, deadline_date, urgent_escalation_date, status,
               original_adjudicator_id, evidence_checklist_json)
            VALUES
              (${rec.id}::uuid, ${rec.claimId}, ${rec.patientToken}::uuid,
               ${rec.practiceId}::uuid, ${rec.denialReasonCode},
               ${rec.denialDate}::date, ${rec.deadlineDate}::date,
               ${rec.urgentEscalationDate}::date, ${rec.status},
               ${rec.originalAdjudicatorId ?? null}, ${JSON.stringify([])}::jsonb)
            ON CONFLICT DO NOTHING
          `;
        }
      }

      res.json({
        processed: claims.length,
        newReconsiderations: result.newReconsiderations.length,
        urgentEscalations: result.urgentEscalations.length,
        urgentClaimIds: result.urgentEscalations.map(r => r.claimId),
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

      interface QueueRow {
        id: string; claim_id: string; patient_token: string; practice_id: string;
        denial_reason_code: string; denial_date: Date | string; deadline_date: Date | string;
        urgent_escalation_date: Date | string; status: string; evidence_checklist_json: unknown;
        original_adjudicator_id: string | null; assigned_adjudicator_id: string | null;
        notes: string | null; created_at: Date | string; updated_at: Date | string;
        cdt_code: string; province: string; procedure_fee_cents: number;
      }
      const rows = await prisma.$queryRaw<QueueRow[]>`
        SELECT r.*, d.cdt_code, d.province, d.procedure_fee_cents
        FROM cdcp_reconsiderations r
        JOIN cdcp_denied_claims d ON d.claim_id = r.claim_id
        WHERE r.practice_id = ${practiceId}::uuid
          AND r.status IN ('eligible', 'urgent', 'submitted')
        ORDER BY r.deadline_date ASC
      `;

      // Re-run triage with current date for accurate status
      const records: ReconsiderationRecord[] = rows.map((row: QueueRow) => ({
        id: row.id,
        claimId: row.claim_id,
        patientToken: row.patient_token,
        practiceId: row.practice_id,
        denialReasonCode: row.denial_reason_code as CdcpDenialReasonCode,
        denialDate: new Date(row.denial_date),
        deadlineDate: new Date(row.deadline_date),
        urgentEscalationDate: new Date(row.urgent_escalation_date),
        status: row.status as ReconsiderationStatus,
        evidenceChecklist: (row.evidence_checklist_json as EvidenceChecklistItem[]) ?? [],
        originalAdjudicatorId: row.original_adjudicator_id ?? undefined,
        assignedAdjudicatorId: row.assigned_adjudicator_id ?? undefined,
        notes: row.notes ?? undefined,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
      }));

      const triaged = triageReconsiderationQueue(records);

      res.json({
        total: triaged.length,
        urgent: triaged.filter(t => t.priority === 'urgent').length,
        queue: triaged.map(t => ({
          ...t,
          cdtCode: rows.find(r => r.claim_id === t.record.claimId)?.cdt_code,
          province: rows.find(r => r.claim_id === t.record.claimId)?.province,
        })),
      });
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
  router.patch('/reconsiderations/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status, assignedAdjudicatorId, confirmationNumber, notes, submissionMethod } = req.body;
      const practiceId = req.practiceAuth?.practiceId;

      // If assigning an adjudicator, validate rotation
      if (assignedAdjudicatorId) {
        const existing = await prisma.$queryRaw<{ original_adjudicator_id: string }[]>`
          SELECT original_adjudicator_id FROM cdcp_reconsiderations
          WHERE id = ${id}::uuid AND practice_id = ${practiceId}::uuid
        `;
        if (existing.length === 0) {
          return res.status(404).json({ error: 'Reconsideration not found' });
        }

        const rotationCheck = validateAdjudicatorRotation(
          existing[0].original_adjudicator_id,
          assignedAdjudicatorId
        );
        if (!rotationCheck.valid) {
          return res.status(422).json({ error: rotationCheck.reason });
        }
      }

      await prisma.$executeRaw`
        UPDATE cdcp_reconsiderations
        SET
          status = COALESCE(${status ?? null}, status),
          assigned_adjudicator_id = COALESCE(${assignedAdjudicatorId ?? null}, assigned_adjudicator_id),
          confirmation_number = COALESCE(${confirmationNumber ?? null}, confirmation_number),
          submission_method = COALESCE(${submissionMethod ?? null}, submission_method),
          submitted_at = CASE WHEN ${status ?? null} = 'submitted' THEN NOW() ELSE submitted_at END,
          notes = COALESCE(${notes ?? null}, notes),
          updated_at = NOW()
        WHERE id = ${id}::uuid AND practice_id = ${practiceId}::uuid
      `;

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

  // ── GET /api/cdcp/kpi ───────────────────────────────────────────────────────
  router.get('/kpi', async (req: Request, res: Response) => {
    try {
      const practiceId = req.practiceAuth?.practiceId;
      const { date } = req.query as { date?: string };
      const snapshotDate = date ?? new Date().toISOString().slice(0, 10);

      const rows = await prisma.$queryRaw<any[]>`
        SELECT * FROM phase5_kpi_snapshots
        WHERE practice_id = ${practiceId}::uuid
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

  return router;
}
