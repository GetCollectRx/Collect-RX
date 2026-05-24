import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../middleware/authenticate';
import {
  practiceIdFromSession,
  queryPracticeConflictsSession,
  requirePracticeContext,
} from '../middleware/requirePracticeSession';
import { parseSimpleCsv } from '../csv/parseSimple';
import { upsertBalances } from '../patients/balances';
import { appendAuditLog } from '../audit/auditLog.js';
import type { Prisma } from '@prisma/client';
import { apiErrorMessageForResponse } from '../apiErrorMessage.js';
import { validateCsvUploadFile } from '../validation/csvUpload.js';
import { isPlatformDev } from '../accessControl/types.js';
import { requirePracticeOwner } from '../middleware/requirePracticeOwner.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

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

router.get('/integrations', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const base = integrationPayload();
    const acct = await prisma.stripeConnectAccount.findUnique({ where: { practiceId } });
    if (acct) {
      base.stripeConnect = {
        account: true,
        onboardingComplete: acct.onboardingComplete,
        chargesEnabled: acct.chargesEnabled,
      };
    }
    return res.json(base);
  } catch (err) {
    console.error('[GET /admin/integrations]', err);
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

router.post('/generate-balances', async (req: Request, res: Response) => {
  try {
    if (isPlatformDev(req.auth)) {
      return res.status(403).json({
        error: 'Demo patient generation is not available for platform developer sessions',
      });
    }
    const practiceId = practiceIdFromSession(req);
    const rawCount = (req.body as { count?: number })?.count;
    const parsed = typeof rawCount === 'number' ? rawCount : parseInt(String(rawCount ?? 10), 10);
    const count = Math.min(200, Math.max(1, Number.isFinite(parsed) ? Math.floor(parsed) : 10));
    let created = 0;
    for (let i = 0; i < count; i++) {
      await prisma.patientBalance.create({
        data: {
          patientFirstName: 'Demo',
          patientLastName: `Patient ${i + 1}`,
          patientOwes: 50 + (i % 5) * 25,
          amountBilled: 200,
          insurancePaid: 100,
          daysSinceAdjudication: (i % 90) + 1,
          practiceId,
          paymentStatus: 'outstanding',
          reminderStatus: 'none',
        },
      });
      created++;
    }
    void appendAuditLog(prisma, {
      practiceId,
      action: 'admin.generate_balances',
      subjectType: 'Practice',
      subjectId: practiceId,
      details: { count: created },
      req,
    });
    return res.json({ message: `Created ${created} demo patient balance rows.` });
  } catch (err) {
    console.error('[POST /admin/generate-balances]', err);
    return res.status(500).json({ error: apiErrorMessageForResponse(err) });
  }
});

router.post('/import-patient-csv', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (isPlatformDev(req.auth)) {
      return res.status(403).json({
        error: 'Patient CSV import is not available for platform developer sessions',
      });
    }
    const practiceId = practiceIdFromSession(req);
    const uploadCheck = validateCsvUploadFile(req.file, { maxBytes: 8 * 1024 * 1024 });
    if (!uploadCheck.ok) {
      return res.status(uploadCheck.status).json({ error: uploadCheck.error });
    }
    const text = req.file!.buffer!.toString('utf8');
    const rawRows = parseSimpleCsv(text);
    const rows = rawRows.map((r) => {
      const o: Record<string, string | number | undefined> = {};
      for (const [k, v] of Object.entries(r)) {
        const num = parseFloat(v);
        if (['patient_owes', 'amount_billed', 'insurance_paid', 'days_since_adjudication'].includes(k)) {
          o[k] = Number.isFinite(num) ? num : v;
        } else {
          o[k] = v;
        }
      }
      return o;
    });
    const result = await upsertBalances(rows as never, practiceId);
    void appendAuditLog(prisma, {
      practiceId,
      action: 'admin.csv.import',
      subjectType: 'Practice',
      subjectId: practiceId,
      details: { imported: result.imported, updated: result.updated, skipped: result.skipped },
      req,
    });
    return res.json(result);
  } catch (err) {
    console.error('[POST /admin/import-patient-csv]', err);
    return res.status(500).json({ error: apiErrorMessageForResponse(err) });
  }
});

export default router;
