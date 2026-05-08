/**
 * Phase 2 Canadian expansion — MOD-01 / MOD-03 / MOD-04 / MOD-05 API surfaces.
 */

import { Router, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { appendAuditLog } from '../audit/auditLog';
import { getComplianceDisclosures } from '../canadianExpansion/complianceDisclosures';
import {
  estimatePrecisionGap,
  type ProvinceCode,
} from '../canadianExpansion/gapEstimator';
import {
  deriveInitialStatus,
  enrichCase,
  reconsiderationExpiresAt,
} from '../canadianExpansion/reconsideration';

function practiceId(req: Request): string {
  return req.practiceAuth!.practiceId;
}

export function createCanadianExpansionRouter(prisma: PrismaClient): Router {
  const r = Router();

  /** MOD-01 — list CDCP reconsideration cases with 60-day countdown */
  r.get('/canadian/cdcp/reconsiderations', async (req: Request, res: Response) => {
    try {
      const pid = practiceId(req);
      const rows = await prisma.cdcpReconsiderationCase.findMany({
        where: { practiceId: pid },
        orderBy: { denialDate: 'desc' },
        take: 200,
      });
      return res.json({
        cases: rows.map((row) => enrichCase(row)),
      });
    } catch (e) {
      console.error('GET reconsiderations', e);
      return res.status(500).json({ error: 'Failed to load reconsiderations' });
    }
  });

  /** MOD-01 — register a denied predetermination / claim for tracking */
  r.post('/canadian/cdcp/reconsiderations', async (req: Request, res: Response) => {
    try {
      const pid = practiceId(req);
      const body = req.body as {
        patient_token?: string;
        claim_ref?: string;
        carrier_code?: string;
        procedure_code?: string;
        denial_date?: string;
        clinical_evidence_summary?: string;
        original_adjudicator_hint?: string;
      };
      const patientToken = String(body.patient_token || '').trim();
      const claimRef = String(body.claim_ref || '').trim();
      if (!patientToken || !claimRef) {
        return res.status(400).json({ error: 'patient_token and claim_ref are required' });
      }
      const belongs = await prisma.patientBalance.findFirst({
        where: { practiceId: pid, patientToken },
        select: { id: true },
      });
      if (!belongs) {
        return res.status(404).json({ error: 'Patient not found for this practice' });
      }
      let denialDate = body.denial_date ? new Date(body.denial_date) : new Date();
      if (Number.isNaN(denialDate.getTime())) {
        denialDate = new Date();
      }
      const carrierCode = String(body.carrier_code || 'cdcp_sunlife').trim() || 'cdcp_sunlife';
      const proc = body.procedure_code?.trim() || null;
      const init = deriveInitialStatus(proc || '');

      const row = await prisma.cdcpReconsiderationCase.create({
        data: {
          practiceId: pid,
          patientToken,
          claimRef,
          carrierCode,
          procedureCode: proc,
          denialDate,
          status: init.status,
          exclusionReason: init.exclusionReason,
          clinicalEvidenceSummary: body.clinical_evidence_summary?.trim() || null,
          originalAdjudicatorHint: body.original_adjudicator_hint?.trim() || null,
        },
      });

      void appendAuditLog(prisma, {
        practiceId: pid,
        action: 'canadian.cdcp.reconsideration.create',
        subjectType: 'CdcpReconsiderationCase',
        subjectId: row.id,
        details: {
          claimRef,
          status: row.status,
          expiry: reconsiderationExpiresAt(denialDate).toISOString(),
        },
        req: req as Request,
      });

      return res.status(201).json({ case: enrichCase(row) });
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'code' in e ? (e as { code?: string }).code : '';
      if (msg === 'P2002') {
        return res.status(409).json({ error: 'A case for this claim reference already exists' });
      }
      console.error('POST reconsiderations', e);
      return res.status(500).json({ error: 'Failed to create reconsideration case' });
    }
  });

  r.patch('/canadian/cdcp/reconsiderations/:id', async (req: Request, res: Response) => {
    try {
      const pid = practiceId(req);
      const id = req.params.id;
      const body = req.body as { status?: string };
      const status = String(body.status || '').trim();
      const allowed = new Set([
        'open',
        'pending_evidence',
        'submitted',
        'won',
        'lost',
        'expired',
        'excluded',
      ]);
      if (!allowed.has(status)) {
        return res.status(400).json({ error: 'invalid status' });
      }
      const existing = await prisma.cdcpReconsiderationCase.findFirst({
        where: { id, practiceId: pid },
      });
      if (!existing) {
        return res.status(404).json({ error: 'Not found' });
      }
      const row = await prisma.cdcpReconsiderationCase.update({
        where: { id },
        data: { status },
      });
      return res.json({ case: enrichCase(row) });
    } catch (e) {
      console.error('PATCH reconsiderations', e);
      return res.status(500).json({ error: 'Failed to update case' });
    }
  });

  /** MOD-03 — precision gap estimate (fee guide subset + CDCP schedule snapshot) */
  r.post('/canadian/gap-estimate', async (req: Request, res: Response) => {
    try {
      const body = req.body as {
        province?: string;
        procedures?: Array<{ cdt_code: string; office_fee_cad: number }>;
      };
      const prov = (body.province || 'ON').toUpperCase() as ProvinceCode;
      if (!['ON', 'BC', 'AB'].includes(prov)) {
        return res.status(400).json({ error: 'province must be ON, BC, or AB' });
      }
      const procs = Array.isArray(body.procedures) ? body.procedures : [];
      if (procs.length === 0) {
        return res.status(400).json({ error: 'procedures required' });
      }
      const summary = estimatePrecisionGap(
        prov,
        procs.map((p) => ({
          cdtCode: p.cdt_code,
          officeFeeCad: Number(p.office_fee_cad),
        }))
      );
      return res.json(summary);
    } catch (e) {
      console.error('gap-estimate', e);
      return res.status(500).json({ error: 'Gap estimate failed' });
    }
  });

  /** MOD-02 — disclosure blocks for carriers / Quebec readiness */
  r.get('/canadian/compliance/disclosures', (_req: Request, res: Response) => {
    return res.json(getComplianceDisclosures());
  });

  /** MOD-04 — log PMS write-back intent (Abeldent UPDATE executed on-premise; this is cloud audit + coordination). */
  r.post('/canadian/pms/writeback', async (req: Request, res: Response) => {
    try {
      const pid = practiceId(req);
      const body = req.body as {
        source?: string;
        claim_ref?: string;
        abeldent_patient_id?: string;
        payload?: Record<string, unknown>;
      };
      const source = String(body.source || '').trim();
      if (source !== 'resolution_closer' && source !== 'escalation_closer') {
        return res
          .status(400)
          .json({ error: 'source must be resolution_closer or escalation_closer' });
      }
      const claimRef = String(body.claim_ref || '').trim();
      if (!claimRef) {
        return res.status(400).json({ error: 'claim_ref required' });
      }
      const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
      const row = await prisma.pmsWritebackLog.create({
        data: {
          practiceId: pid,
          source,
          claimRef,
          abeldentPatientId: body.abeldent_patient_id?.trim() || null,
          payload: payload as object,
        },
      });
      void appendAuditLog(prisma, {
        practiceId: pid,
        action: 'canadian.pms.writeback',
        subjectType: 'PmsWritebackLog',
        subjectId: row.id,
        details: { source, claimRef },
        req: req as Request,
      });
      return res.status(201).json({
        ok: true,
        id: row.id,
        message:
          'Write-back logged. Apply matching UPDATE in AbelDent via desktop connector using your schema-map.',
      });
    } catch (e) {
      console.error('pms writeback', e);
      return res.status(500).json({ error: 'Write-back log failed' });
    }
  });

  r.get('/canadian/pms/writeback-log', async (req: Request, res: Response) => {
    try {
      const pid = practiceId(req);
      const take = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
      const rows = await prisma.pmsWritebackLog.findMany({
        where: { practiceId: pid },
        orderBy: { createdAt: 'desc' },
        take,
        select: {
          id: true,
          source: true,
          claimRef: true,
          abeldentPatientId: true,
          payload: true,
          createdAt: true,
        },
      });
      return res.json({ entries: rows });
    } catch (e) {
      console.error('writeback-log', e);
      return res.status(500).json({ error: 'Failed to load write-back log' });
    }
  });

  return r;
}
