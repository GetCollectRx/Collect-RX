import { Router, type Request, type Response } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../middleware/authenticate';
import {
  practiceIdFromSession,
  queryPracticeConflictsSession,
  requirePracticeContext,
} from '../middleware/requirePracticeSession';
import { appendAuditLog } from '../audit/auditLog.js';
import type { Prisma } from '@prisma/client';
import { apiErrorMessageForResponse } from '../apiErrorMessage.js';
import { isPlatformDev, authUserId } from '../accessControl/types.js';
import { requirePracticeOwner } from '../middleware/requirePracticeOwner.js';
import { reviewLesson } from '../learning/carrierLessons.js';

const router = Router();
router.use(authenticate);
router.use(requirePracticeContext);
router.use((req, res, next) => {
  if (isPlatformDev(req.auth)) return next();
  return requirePracticeOwner(req, res, next);
});

function integrationPayload() {
  const sk = process.env.STRIPE_SECRET_KEY?.trim() ?? '';
  return {
    sendgrid: {
      apiKey: Boolean(process.env.SENDGRID_API_KEY?.trim()),
      fromEmail: Boolean(process.env.SENDGRID_FROM_EMAIL?.trim()),
      eventWebhookVerifyKey: Boolean(process.env.SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY?.trim()),
    },
    twilio: {
      apiAndFrom: Boolean(process.env.TWILIO_ACCOUNT_SID?.trim() && process.env.TWILIO_FROM_NUMBER?.trim()),
      inboundUrlForSignature: Boolean(process.env.TWILIO_SMS_INBOUND_URL?.trim()),
    },
    escalation: {
      staffPhone: Boolean(process.env.ESCALATION_STAFF_PHONE?.trim()),
      immediateStaffNotify: Boolean(
        process.env.ESCALATION_STAFF_PHONE?.trim() &&
          process.env.TWILIO_ACCOUNT_SID?.trim() &&
          process.env.TWILIO_FROM_NUMBER?.trim(),
      ),
      voiceRing: (process.env.ESCALATION_STAFF_VOICE_RING || 'urgent').trim(),
    },
    stripe: {
      secretKey: Boolean(sk),
      testMode: sk.startsWith('sk_test_'),
    },
    stripeConnect: {
      account: false,
      onboardingComplete: false,
      chargesEnabled: false,
    },
    vapi: {
      webhookSecret: Boolean(process.env.VAPI_WEBHOOK_SECRET?.trim()),
    },
    email: {
      unsubscribeHmac: Boolean(
        (process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.JWT_SECRET || '').trim(),
      ),
      publicApiBase:
        process.env.PUBLIC_API_BASE_URL?.trim() ||
        process.env.PUBLIC_APP_URL?.trim() ||
        'http://localhost:3000',
    },
  };
}

router.get('/settings', async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.practiceId === 'string' ? req.query.practiceId.trim() : '';
    if (queryPracticeConflictsSession(req, q || undefined)) {
      return res.status(403).json({ error: 'practiceId does not match session' });
    }
    const practiceId = practiceIdFromSession(req);
    const row = await prisma.practice.findUnique({
      where: { id: practiceId },
      select: { settings: true },
    });
    return res.json({ settings: row?.settings ?? null });
  } catch (err) {
    console.error('[GET /admin/settings]', err);
    return res.status(500).json({ error: apiErrorMessageForResponse(err) });
  }
});

router.put('/settings', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const body = req.body as { settings?: Prisma.JsonObject };
    if (!body?.settings || typeof body.settings !== 'object') {
      return res.status(400).json({ error: 'settings object required' });
    }
    await prisma.practice.update({
      where: { id: practiceId },
      data: { settings: body.settings as Prisma.InputJsonValue },
    });
    void appendAuditLog(prisma, {
      practiceId,
      action: 'admin.settings.update',
      subjectType: 'Practice',
      subjectId: practiceId,
      details: { keys: Object.keys(body.settings) },
      req,
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[PUT /admin/settings]', err);
    return res.status(500).json({ error: apiErrorMessageForResponse(err) });
  }
});

router.get('/integrations', async (_req: Request, res: Response) => {
  try {
    const base = integrationPayload();
    // Stripe Connect (patient payment collection) removed — stripeConnect defaults to disabled.
    return res.json(base);
  } catch (err) {
    console.error('[GET /admin/integrations]', err);
    return res.status(500).json({ error: apiErrorMessageForResponse(err) });
  }
});

// ── Practice Identity ──────────────────────────────────────────────────────
// Direct Practice-model fields (not the settings JSON blob).
// These are read aloud by the voice agent and used for carrier identity checks.

const ADDRESS_MAX = 200;
const E164 = /^\+[1-9]\d{7,14}$/;

router.get('/practice-identity', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const row = await prisma.practice.findUnique({
      where: { id: practiceId },
      select: {
        name: true,
        billingPhone: true,
        faxNumber: true,
        practiceAddress: true,
        npi: true,
        taxId: true,
      },
    });
    if (!row) return res.status(404).json({ error: 'Practice not found' });
    return res.json({
      name: row.name,
      billingPhone: row.billingPhone ?? '',
      faxNumber: row.faxNumber ?? '',
      practiceAddress: row.practiceAddress ?? '',
      npi: row.npi ?? '',
      taxId: row.taxId ?? '',
    });
  } catch (err) {
    console.error('[GET /admin/practice-identity]', err);
    return res.status(500).json({ error: apiErrorMessageForResponse(err) });
  }
});

router.put('/practice-identity', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const body = req.body as {
      billingPhone?: string;
      faxNumber?: string;
      practiceAddress?: string;
      npi?: string;
      taxId?: string;
    };

    const patch: Prisma.PracticeUpdateInput = {};

    if (body.billingPhone !== undefined) {
      const v = body.billingPhone.trim();
      if (v && !E164.test(v)) {
        return res.status(400).json({ error: 'billingPhone must be a valid E.164 number (+1...)' });
      }
      patch.billingPhone = v || null;
    }

    if (body.faxNumber !== undefined) {
      const v = body.faxNumber.trim();
      if (v && !E164.test(v)) {
        return res.status(400).json({ error: 'faxNumber must be a valid E.164 number (+1...)' });
      }
      patch.faxNumber = v || null;
    }

    if (body.practiceAddress !== undefined) {
      const v = body.practiceAddress.trim();
      if (v.length > ADDRESS_MAX) {
        return res.status(400).json({ error: `practiceAddress must be ${ADDRESS_MAX} characters or fewer` });
      }
      patch.practiceAddress = v || null;
    }

    if (body.npi !== undefined) {
      patch.npi = body.npi.trim() || null;
    }

    if (body.taxId !== undefined) {
      patch.taxId = body.taxId.trim() || null;
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }

    await prisma.practice.update({ where: { id: practiceId }, data: patch });
    void appendAuditLog(prisma, {
      practiceId,
      action: 'admin.practice_identity.update',
      subjectType: 'Practice',
      subjectId: practiceId,
      details: { keys: Object.keys(patch) },
      req,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('[PUT /admin/practice-identity]', err);
    return res.status(500).json({ error: apiErrorMessageForResponse(err) });
  }
});

router.get('/audit-log', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const lim = Math.min(parseInt(String(req.query.limit || '30'), 10) || 30, 200);
    const rows = await prisma.auditLog.findMany({
      where: { practiceId },
      orderBy: { createdAt: 'desc' },
      take: lim,
      select: {
        id: true,
        createdAt: true,
        action: true,
        subjectType: true,
        subjectId: true,
        details: true,
        requestIp: true,
      },
    });
    return res.json({
      entries: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        action: r.action,
        subjectType: r.subjectType,
        subjectId: r.subjectId,
        details: r.details,
        requestIp: r.requestIp,
      })),
    });
  } catch (err) {
    console.error('[GET /admin/audit-log]', err);
    return res.status(500).json({ error: apiErrorMessageForResponse(err) });
  }
});

// ---------------------------------------------------------------------------
// Carrier lessons — learning-loop review queue.
// Lessons are platform-wide carrier knowledge (no PHI, no practice data);
// only APPROVED lessons are ever injected into live call instructions.
// ---------------------------------------------------------------------------
router.get('/carrier-lessons', async (req: Request, res: Response) => {
  try {
    const status = String(req.query.status ?? 'PROPOSED');
    if (!['PROPOSED', 'APPROVED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ error: 'status must be PROPOSED, APPROVED, or REJECTED' });
    }
    const lessons = await prisma.carrierLesson.findMany({
      where: { status: status as 'PROPOSED' | 'APPROVED' | 'REJECTED' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return res.json({ lessons });
  } catch (err) {
    console.error('[GET /admin/carrier-lessons]', err);
    return res.status(500).json({ error: apiErrorMessageForResponse(err) });
  }
});

router.post('/carrier-lessons/:id/review', async (req: Request, res: Response) => {
  try {
    const action = (req.body as { action?: string })?.action;
    if (action !== 'approve' && action !== 'reject') {
      return res.status(400).json({ error: 'action must be "approve" or "reject"' });
    }
    const reviewer = authUserId(req.auth) ?? 'unknown';
    const updated = await reviewLesson(prisma, req.params.id, action, reviewer);
    if (!updated) {
      return res.status(404).json({ error: 'Lesson not found or already reviewed' });
    }
    void appendAuditLog(prisma, {
      practiceId: practiceIdFromSession(req),
      action: `admin.carrier-lesson.${action}`,
      subjectType: 'CarrierLesson',
      subjectId: req.params.id,
      details: {},
      req,
    });
    return res.json({ ok: true, status: action === 'approve' ? 'APPROVED' : 'REJECTED' });
  } catch (err) {
    console.error('[POST /admin/carrier-lessons/:id/review]', err);
    return res.status(500).json({ error: apiErrorMessageForResponse(err) });
  }
});

export default router;
