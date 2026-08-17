/**
 * Phase 2 Canadian expansion — MOD-01 / MOD-03 / MOD-04 / MOD-05 API surfaces.
 */

import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import type { PrismaClient } from '@prisma/client';
import { appendAuditLog } from '../audit/auditLog';
import { getComplianceDisclosures } from '../canadianExpansion/complianceDisclosures';
import { computeEightDimensions } from '../canadianExpansion/eightDimensionMetrics';
import { getItransStatus } from '../canadianExpansion/itrans2';
import { estimatePrecisionGapWithDb } from '../canadianExpansion/gapEstimator';
import {
  importFeeGuide,
  parseFeeRows,
  type Scope,
} from '../canadianExpansion/feeGuideRepo';
import { parseSimpleCsv } from '../csv/parseSimple';
import {
  deriveInitialStatus,
  enrichCase,
  reconsiderationExpiresAt,
} from '../canadianExpansion/reconsideration';
import {
  ValidationError,
  validateGapEstimate,
  validateReconsiderationCreate,
  validateReconsiderationStatus,
  validateWriteback,
} from '../canadianExpansion/validators';
import { useOwnerPracticeApiAuthOnly } from '../middleware/ownerPracticeApi.js';
import { validateCsvUploadFile } from '../validation/csvUpload.js';
import { practiceIdFromSession } from '../middleware/requirePracticeSession.js';
import { logger } from '../observability/logger.js';

function practiceId(req: Request): string {
  return practiceIdFromSession(req);
}

function handleError(label: string, e: unknown, res: Response): Response {
  if (e instanceof ValidationError) {
    return res.status(400).json({ error: e.message, field: e.field });
  }
  if (e && typeof e === 'object' && 'code' in e) {
    const code = (e as { code?: string }).code;
    if (code === 'P2002') {
      return res.status(409).json({ error: 'A record with this identifier already exists' });
    }
  }
  logger.error(label, { error: e });
  return res.status(500).json({ error: `${label} failed` });
}

export function createCanadianExpansionRouter(prisma: PrismaClient): Router {
  const r = Router();
  useOwnerPracticeApiAuthOnly(r);

  // Cap heavier compute endpoints. Auth-rate-limit upstream applies first;
  // this is a per-route cushion against accidental tight loops.
  const computeLimiter = rateLimit({
    windowMs: 60_000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests on this endpoint' },
    skip: () => {
      const e2e = (process.env.COLLECTRX_E2E || '').trim();
      return process.env.VITEST === 'true' || e2e === '1' || e2e.toLowerCase() === 'true';
    },
  });

  /** MOD-01 — list CDCP reconsideration cases with 60-day countdown */
  r.get('/canadian/cdcp/reconsiderations', async (req: Request, res: Response) => {
    try {
      const pid = practiceId(req);
      const rows = await prisma.cdcpReconsiderationCase.findMany({
        where: { practiceId: pid },
        orderBy: { denialDate: 'desc' },
        take: 200,
      });
      return res.json({ cases: rows.map((row) => enrichCase(row)) });
    } catch (e) {
      return handleError('GET reconsiderations', e, res);
    }
  });

  /** MOD-01 — register a denied predetermination / claim for tracking */
  r.post('/canadian/cdcp/reconsiderations', blockAuditorWrites, async (req: Request, res: Response) => {
    try {
      const pid = practiceId(req);
      const input = validateReconsiderationCreate(req.body);
      const init = deriveInitialStatus(input.procedureCode || '');
      const row = await prisma.cdcpReconsiderationCase.create({
        data: {
          practiceId: pid,
          patientToken: input.patientToken,
          claimRef: input.claimRef,
          carrierCode: input.carrierCode,
          procedureCode: input.procedureCode ?? null,
          denialDate: input.denialDate,
          status: init.status,
          exclusionReason: init.exclusionReason,
          clinicalEvidenceSummary: input.clinicalEvidenceSummary ?? null,
          originalAdjudicatorHint: input.originalAdjudicatorHint ?? null,
        },
      });
      void appendAuditLog(prisma, {
        practiceId: pid,
        action: 'canadian.cdcp.reconsideration.create',
        subjectType: 'CdcpReconsiderationCase',
        subjectId: row.id,
        details: {
          claimRef: input.claimRef,
          status: row.status,
          expiry: reconsiderationExpiresAt(input.denialDate).toISOString(),
        },
        req,
      });
      return res.status(201).json({ case: enrichCase(row) });
    } catch (e) {
      return handleError('POST reconsiderations', e, res);
    }
  });

  r.patch('/canadian/cdcp/reconsiderations/:id', blockAuditorWrites, async (req: Request, res: Response) => {
    try {
      const pid = practiceId(req);
      const id = req.params.id;
      const status = validateReconsiderationStatus(req.body);
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
      void appendAuditLog(prisma, {
        practiceId: pid,
        action: 'canadian.cdcp.reconsideration.update',
        subjectType: 'CdcpReconsiderationCase',
        subjectId: row.id,
        details: { from: existing.status, to: status, claimRef: row.claimRef },
        req,
      });
      return res.json({ case: enrichCase(row) });
    } catch (e) {
      return handleError('PATCH reconsiderations', e, res);
    }
  });

  /** MOD-03 — precision gap estimate (DB-backed fee guide → bundled fallback) */
  r.post('/canadian/gap-estimate', computeLimiter, async (req: Request, res: Response) => {
    try {
      const input = validateGapEstimate(req.body);
      const summary = await estimatePrecisionGapWithDb(
        prisma,
        input.province,
        input.procedures.map((p) => ({
          cdtCode: p.cdt_code,
          officeFeeCad: p.office_fee_cad,
        }))
      );
      return res.json(summary);
    } catch (e) {
      return handleError('gap-estimate', e, res);
    }
  });

  /** MOD-03 — list imported fee guide entries (for admin / verification) */
  r.get('/canadian/fee-guide', async (req: Request, res: Response) => {
    try {
      const scope = String(req.query.scope || '').toUpperCase();
      if (!['CDCP', 'ON', 'BC', 'AB'].includes(scope)) {
        return res
          .status(400)
          .json({ error: 'scope must be CDCP, ON, BC, or AB' });
      }
      const entries = await prisma.feeGuideEntry.findMany({
        where: { scope },
        orderBy: [{ effectiveDate: 'desc' }, { cdtCode: 'asc' }],
        take: 1000,
      });
      const summary = entries.reduce<Record<string, number>>((acc, row) => {
        const key = row.effectiveDate.toISOString().split('T')[0]!;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      return res.json({ scope, summary, entries });
    } catch (e) {
      return handleError('fee-guide list', e, res);
    }
  });

  /** MOD-03 — upload a fee guide CSV. Columns: cdt_code, fee_cad [, source, notes]. */
  const csvUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 },
  });
  r.post(
    '/canadian/fee-guide/import',
    blockAuditorWrites,
    preserveRlsAcrossMiddleware(csvUpload.single('file')),
    async (req: Request, res: Response) => {
      try {
        const pid = practiceId(req);
        const scope = String(req.body?.scope || req.query?.scope || '').toUpperCase();
        const effectiveRaw = String(
          req.body?.effective_date || req.query?.effective_date || ''
        ).trim();
        if (!['CDCP', 'ON', 'BC', 'AB'].includes(scope)) {
          return res.status(400).json({ error: 'scope must be CDCP, ON, BC, or AB' });
        }
        const effective = effectiveRaw ? new Date(effectiveRaw) : null;
        if (!effective || Number.isNaN(effective.getTime())) {
          return res.status(400).json({ error: 'effective_date (YYYY-MM-DD) is required' });
        }
        const file = (req as Request & { file?: { buffer?: Buffer } }).file;
        const uploadCheck = validateCsvUploadFile(file, { maxBytes: 2 * 1024 * 1024 });
        if (!uploadCheck.ok) {
          return res.status(uploadCheck.status).json({ error: uploadCheck.error });
        }
        const text = file!.buffer!.toString('utf8');
        const parsed = parseSimpleCsv(text);
        if (parsed.length === 0) {
          return res.status(400).json({ error: 'CSV had no data rows' });
        }
        const { rows, errors } = parseFeeRows(parsed);
        if (rows.length === 0) {
          return res.status(400).json({ error: 'No valid rows', errors });
        }
        const result = await importFeeGuide(prisma, scope as Scope, effective, rows);
        void appendAuditLog(prisma, {
          practiceId: pid,
          action: 'canadian.fee_guide.import',
          subjectType: 'FeeGuideEntry',
          subjectId: `${scope}:${effectiveRaw}`,
          details: {
            scope,
            effectiveDate: effectiveRaw,
            inserted: result.inserted,
            updated: result.updated,
            rejected: errors.length,
          },
          req,
        });
        return res.json({ ok: true, scope, effectiveDate: effectiveRaw, ...result, errors });
      } catch (e) {
        return handleError('fee-guide import', e, res);
      }
    }
  );

  /** MOD-04 — log PMS write-back intent (Abeldent UPDATE executed on-premise; this is cloud audit + coordination). */
  r.post('/canadian/pms/writeback', blockAuditorWrites, async (req: Request, res: Response) => {
    try {
      const pid = practiceId(req);
      const input = validateWriteback(req.body);
      const row = await prisma.pmsWritebackLog.create({
        data: {
          practiceId: pid,
          source: input.source,
          claimRef: input.claimRef,
          abeldentPatientId: input.abeldentPatientId ?? null,
          payload: input.payload as object,
        },
      });
      void appendAuditLog(prisma, {
        practiceId: pid,
        action: 'canadian.pms.writeback',
        subjectType: 'PmsWritebackLog',
        subjectId: row.id,
        details: { source: input.source, claimRef: input.claimRef },
        req,
      });
      return res.status(201).json({
        ok: true,
        id: row.id,
        status: 'pending',
        message:
          'Write-back logged. Desktop connector polls /api/canadian/pms/writeback-pending and applies AbelDent UPDATE via schema-map.',
      });
    } catch (e) {
      return handleError('pms writeback', e, res);
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
          processedAt: true,
          processError: true,
          createdAt: true,
        },
      });
      return res.json({ entries: rows });
    } catch (e) {
      return handleError('writeback-log', e, res);
    }
  });

  /**
   * Desktop connector poll — returns pending write-backs for execution on-prem.
   * Authenticated via the existing practice JWT (long-lived service token).
   */
  r.get('/canadian/pms/writeback-pending', async (req: Request, res: Response) => {
    try {
      const pid = practiceId(req);
      const take = Math.min(50, Math.max(1, Number(req.query.limit) || 25));
      const rows = await prisma.pmsWritebackLog.findMany({
        where: { practiceId: pid, processedAt: null, processError: null },
        orderBy: { createdAt: 'asc' },
        take,
      });
      return res.json({ entries: rows });
    } catch (e) {
      return handleError('writeback-pending', e, res);
    }
  });

  /**
   * Desktop connector ack — mark a write-back row as processed (or error).
   * Body: { id, ok: boolean, error?: string, durationMs?: number }
   */
  r.post('/canadian/pms/writeback-ack', blockAuditorWrites, async (req: Request, res: Response) => {
    try {
      const pid = practiceId(req);
      const b = (req.body || {}) as Record<string, unknown>;
      const id = String(b.id || '').trim();
      if (!id) {
        return res.status(400).json({ error: 'id required' });
      }
      const ok = Boolean(b.ok);
      const errMsg = typeof b.error === 'string' ? b.error.slice(0, 500) : null;
      const existing = await prisma.pmsWritebackLog.findFirst({
        where: { id, practiceId: pid },
      });
      if (!existing) {
        return res.status(404).json({ error: 'Not found' });
      }
      await prisma.pmsWritebackLog.update({
        where: { id },
        data: ok
          ? { processedAt: new Date(), processError: null }
          : { processError: errMsg || 'unknown error' },
      });
      void appendAuditLog(prisma, {
        practiceId: pid,
        action: ok ? 'canadian.pms.writeback.ack' : 'canadian.pms.writeback.error',
        subjectType: 'PmsWritebackLog',
        subjectId: id,
        details: { ok, error: errMsg, durationMs: Number(b.durationMs) || null },
        req,
      });
      return res.json({ ok: true });
    } catch (e) {
      return handleError('writeback-ack', e, res);
    }
  });

  /** MOD-02 — Law 25 / AIDA transparency / CRTC ADAD disclosure bundle */
  r.get('/canadian/compliance/disclosures', (_req: Request, res: Response) => {
    return res.json(getComplianceDisclosures());
  });

  /** Phase-2 command metrics: reconsideration funnel, write-backs, 8 dimensions, ITRANS 2 */
  r.get('/analytics/canadian-phase2', async (req: Request, res: Response) => {
    try {
      const pid = practiceId(req);
      const now = new Date();
      const [
        reconsiderationCasesTotal,
        reconsiderationPipelineActive,
        reconsiderationWindowAttention,
        pmsWritebacksLast7Days,
        pmsWritebacksPending,
        eightDimensions,
      ] = await Promise.all([
        prisma.cdcpReconsiderationCase.count({ where: { practiceId: pid } }),
        prisma.cdcpReconsiderationCase.count({
          where: {
            practiceId: pid,
            status: { in: ['open', 'pending_evidence', 'submitted'] },
          },
        }),
        prisma.cdcpReconsiderationCase.count({
          where: {
            practiceId: pid,
            status: { in: ['open', 'pending_evidence'] },
            denialDate: { gte: new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000) },
          },
        }),
        prisma.pmsWritebackLog.count({
          where: {
            practiceId: pid,
            createdAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
          },
        }),
        prisma.pmsWritebackLog.count({
          where: { practiceId: pid, processedAt: null },
        }),
        computeEightDimensions(prisma, pid),
      ]);
      return res.json({
        reconsiderationCasesTotal,
        reconsiderationPipelineActive,
        reconsiderationWindowAttention,
        pmsWritebacksLast7Days,
        pmsWritebacksPending,
        itrans2: getItransStatus(now),
        eightDimensions,
        eightDimensionLabels: eightDimensions.map((d) => ({ id: d.id, name: d.name })),
      });
    } catch (e) {
      return handleError('canadian-phase2 analytics', e, res);
    }
  });

  return r;
}
