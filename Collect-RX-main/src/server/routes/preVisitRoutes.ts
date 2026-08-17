/**
 * Pre-visit verification API routes.
 */
import express, { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { CarrierId } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../middleware/authenticate.js';
import { requirePracticeContext, practiceIdFromSession } from '../middleware/requirePracticeSession.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { verifyBeforeAppointment } from '../preVisit/appointmentVerification.js';
import { enrichCase } from '../canadianExpansion/reconsideration.js';
import { CARRIER_CONFIGS } from '../../carriers/adapter.js';
import { ingestScheduledAppointments } from '../preVisit/appointmentIngest.js';
import type { PredetArtifact } from '../preVisit/predetSubmissionRules.js';
import {
  importCdcpPredetCases,
  parseCdcpPredetCsvRows,
  type CdcpPredetImportRow,
} from '../preVisit/importCdcpPredetCases.js';
import { patientTokenBelongsToPractice } from '../accessControl/patientTokenScope.js';
import { getAdjudicationGraph } from '../adjudication/adjudicationGraph.js';
import { parseSimpleCsv } from '../csv/parseSimple.js';
import { logger } from '../observability/logger.js';

const CARRIER_IDS = Object.keys(CARRIER_CONFIGS) as [CarrierId, ...CarrierId[]];

const ArtifactSchema = z.object({
  periapical_xray: z.boolean().optional(),
  bitewing_xray: z.boolean().optional(),
  clinical_narrative: z.boolean().optional(),
  treatment_plan: z.boolean().optional(),
  periodontal_charting: z.boolean().optional(),
});

const VerifySchema = z.object({
  patientToken: z.string().min(1),
  carrierId: z.enum(CARRIER_IDS),
  procedureCodes: z.array(z.string().regex(/^D\d{4}$/i)).min(1),
  appointmentAt: z.string().datetime(),
  artifactAttestations: ArtifactSchema.optional(),
});

const AppointmentIngestSchema = z.object({
  appointments: z.array(
    z.object({
      patientToken: z.string().min(1),
      carrierId: z.enum(CARRIER_IDS),
      procedureCodes: z.array(z.string().regex(/^D\d{4}$/i)).min(1),
      appointmentAt: z.string().datetime(),
      pmsSource: z.string().optional(),
      pmsAppointmentId: z.string().optional(),
      artifactAttestations: ArtifactSchema.optional(),
    }),
  ).min(1),
});

const CdcpPredetImportJsonSchema = z.object({
  cases: z.array(
    z.object({
      claimRef: z.string().min(1),
      patientToken: z.string().min(1),
      procedureCode: z.string().min(1),
      denialDate: z.string().min(1),
      clinicalEvidenceSummary: z.string().optional(),
      status: z.string().optional(),
    }),
  ).min(1),
});

const TERMINAL_STATUSES = ['excluded', 'approved', 'denied_final'];

const router = Router();
const csvImportBody = express.text({ type: ['text/csv', 'text/plain'], limit: '2mb' });
router.use(authenticate);
router.use(requirePracticeContext);

router.post('/verify', requirePermission('manage_claims'), async (req: Request, res: Response) => {
  try {
    const parsed = VerifySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }

    const practiceId = practiceIdFromSession(req);
    const owned = await patientTokenBelongsToPractice(prisma, practiceId, parsed.data.patientToken);
    if (!owned) {
      return res.status(403).json({ error: 'patientToken does not belong to this practice' });
    }

    const result = await verifyBeforeAppointment(prisma, {
      practiceId,
      patientToken: parsed.data.patientToken,
      carrierId: parsed.data.carrierId,
      procedureCodes: parsed.data.procedureCodes,
      appointmentAt: new Date(parsed.data.appointmentAt),
      artifactAttestations: parsed.data.artifactAttestations as Partial<Record<PredetArtifact, boolean>>,
    });

    res.json(result);
  } catch (err) {
    logger.error('[pre-visit] /verify error', { error: err });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/appointments/ingest', requirePermission('manage_claims'), async (req: Request, res: Response) => {
  try {
    const parsed = AppointmentIngestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }

    const practiceId = practiceIdFromSession(req);
    for (const appt of parsed.data.appointments) {
      const owned = await patientTokenBelongsToPractice(prisma, practiceId, appt.patientToken);
      if (!owned) {
        return res.status(403).json({ error: 'patientToken does not belong to this practice' });
      }
    }

    const result = await ingestScheduledAppointments(
      prisma,
      practiceId,
      parsed.data.appointments.map((a) => ({
        patientToken: a.patientToken,
        carrierId: a.carrierId,
        procedureCodes: a.procedureCodes,
        appointmentAt: new Date(a.appointmentAt),
        pmsSource: a.pmsSource,
        pmsAppointmentId: a.pmsAppointmentId,
        artifactAttestations: a.artifactAttestations as Partial<Record<PredetArtifact, boolean>>,
      })),
    );

    res.json(result);
  } catch (err) {
    logger.error('[pre-visit] /appointments/ingest error', { error: err });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post(
  '/cdcp-predets/import',
  csvImportBody,
  requirePermission('manage_claims'),
  async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const { isCsvArFeatureEnabled, CSV_AR_FEATURES } = await import('../featureFlags/csvArFeatures.js');
    if (!(await isCsvArFeatureEnabled(prisma, practiceId, CSV_AR_FEATURES.PREVISIT_CSV))) {
      return res.status(403).json({ error: 'Pre-visit CSV import is paused for this practice' });
    }
    const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
    let rows: CdcpPredetImportRow[] = [];
    const parseErrors: Array<{ row: number; claimRef?: string; error: string }> = [];

    if (contentType.includes('text/csv') || contentType.includes('text/plain')) {
      const text = typeof req.body === 'string' ? req.body : '';
      if (!text.trim()) {
        return res.status(400).json({ error: 'CSV body required' });
      }
      const records = parseSimpleCsv(text) as Record<string, unknown>[];
      const parsed = parseCdcpPredetCsvRows(records);
      rows = parsed.rows;
      parseErrors.push(...parsed.errors);
    } else {
      const parsed = CdcpPredetImportJsonSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      rows = parsed.data.cases.map((c) => ({
        claimRef: c.claimRef,
        patientToken: c.patientToken,
        procedureCode: c.procedureCode,
        denialDate: new Date(c.denialDate),
        clinicalEvidenceSummary: c.clinicalEvidenceSummary,
        status: c.status,
      }));
    }

    if (rows.length === 0) {
      return res.status(400).json({
        error: 'No valid rows to import',
        parseErrors,
      });
    }

    const result = await importCdcpPredetCases(prisma, practiceId, rows);
    res.json({ ...result, parseErrors });
  } catch (err) {
    logger.error('[pre-visit] /cdcp-predets/import error', { error: err });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/cdcp-deadlines', requirePermission('manage_claims'), async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const rows = await prisma.cdcpReconsiderationCase.findMany({
      where: {
        practiceId,
        status: { notIn: TERMINAL_STATUSES },
      },
    });

    const enriched = rows
      .map((row) => enrichCase(row))
      .filter((row) => !row.windowExpired)
      .sort((a, b) => a.daysRemaining - b.daysRemaining);

    res.json({ cases: enriched });
  } catch (err) {
    logger.error('[pre-visit] /cdcp-deadlines error', { error: err });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/verifications', requirePermission('manage_claims'), async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const rows = await prisma.appointmentVerification.findMany({
      where: { practiceId },
      orderBy: { appointmentAt: 'asc' },
      take: 100,
    });
    res.json({ verifications: rows });
  } catch (err) {
    logger.error('[pre-visit] /verifications error', { error: err });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/adjudication-events', requirePermission('manage_claims'), async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const rows = await prisma.adjudicationEvent.findMany({
      where: { practiceId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ events: rows });
  } catch (err) {
    logger.error('[pre-visit] /adjudication-events error', { error: err });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/adjudication-graph', requirePermission('manage_claims'), async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const days = Math.min(365, Math.max(7, parseInt(String(req.query.days ?? '90'), 10) || 90));
    const graph = await getAdjudicationGraph(prisma, practiceId, days);
    res.json({ graph });
  } catch (err) {
    logger.error('[pre-visit] /adjudication-graph error', { error: err });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post(
  '/appointments/import-csv',
  csvImportBody,
  requirePermission('manage_claims'),
  async (req: Request, res: Response) => {
    try {
      const practiceId = practiceIdFromSession(req);
      const text = typeof req.body === 'string' ? req.body : '';
      if (!text.trim()) {
        return res.status(400).json({ error: 'CSV body required' });
      }
      const records = parseSimpleCsv(text) as Record<string, unknown>[];
      const { importAppointmentCsvRows } = await import('../preVisit/csvAppointmentImport.js');
      const result = await importAppointmentCsvRows(prisma, practiceId, records);
      res.json(result);
    } catch (err) {
      logger.error('[pre-visit] /appointments/import-csv error', { error: err });
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

export default router;
