/**
 * Pre-visit verification API routes.
 *
 * POST /api/pre-visit/verify          — run carrier/CDCP/eligibility checks ahead of an appointment
 * GET  /api/pre-visit/cdcp-deadlines  — list open CDCP reconsideration cases by urgency
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

const CARRIER_IDS = Object.keys(CARRIER_CONFIGS) as [CarrierId, ...CarrierId[]];

const VerifySchema = z.object({
  patientToken: z.string().min(1),
  carrierId: z.enum(CARRIER_IDS),
  procedureCodes: z.array(z.string().regex(/^D\d{4}$/i)).min(1),
  appointmentAt: z.string().datetime(),
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
    });

    res.json(result);
  } catch (err) {
    console.error('[pre-visit] /verify error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/cdcp-deadlines', async (req: Request, res: Response) => {
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

export default router;
