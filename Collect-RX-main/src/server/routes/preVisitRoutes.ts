/**
 * Pre-visit verification API routes.
 */
import { Router, type Request, type Response } from 'express';
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

const TERMINAL_STATUSES = ['excluded', 'approved', 'denied_final'];

const router = Router();
router.use(authenticate);
router.use(requirePracticeContext);

router.post('/verify', requirePermission('manage_claims'), async (req: Request, res: Response) => {
  try {
    const parsed = VerifySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }

    const practiceId = practiceIdFromSession(req);
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
    console.error('[pre-visit] /verify error:', err);
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
    console.error('[pre-visit] /appointments/ingest error:', err);
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
    console.error('[pre-visit] /cdcp-deadlines error:', err);
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
    console.error('[pre-visit] /verifications error:', err);
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
    console.error('[pre-visit] /adjudication-events error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
