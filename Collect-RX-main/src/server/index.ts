import 'dotenv/config';
import { initSentry, installSentryExpressErrorHandler, isSentryEnabled } from './observability/sentryNode.js';
import { markBoot, getMetrics } from './observability/metrics.js';
import { requestMetricsAndAccessLog } from './observability/httpRequestMetrics.js';
import express from 'express';
import cors from 'cors';
import path from 'path';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { PrismaClient } from '@prisma/client';
import { startRulesEngine } from './rulesEngine.js';
import { startReminderEngine } from './patients/reminderEngine.js';
import { createEligibilityRouter } from '../routes/eligibility';
import { assertJwtConfigAtStartup } from './authToken';
import { parseSimpleCsv } from './csv/parseSimple';
import { upsertBalances } from './patients/balances';
import { authenticate, parseAllowedOrigins } from './middleware/authenticate';
import { createAuthRouter } from './routes/authRoutes';
import { handleWebhook } from './stripe/connect.js';
import { handleVapiWebhook } from './vapi/vapiWebhook.js';
import { handleTwilioInboundSms } from './twilio/inboundSms.js';
import { createBenefitsApiRouter } from './routes/benefitsApi.js';
import { createPatientArApiRouter } from './routes/patientArApi.js';
import { createCanadianExpansionRouter } from './routes/canadianExpansionApi.js';
import { getComplianceDisclosures } from './canadianExpansion/complianceDisclosures.js';
import { computeEightDimensions } from './canadianExpansion/eightDimensionMetrics.js';
import { getItransStatus } from './canadianExpansion/itrans2.js';
import { makeSendgridEventWebhookHandler } from './sendgrid/handleSendgridEventWebhook.js';
import { verifyUnsubscribeRequest, getPublicApiBase } from './email/unsubscribeUrl.js';
import { appendAuditLog } from './audit/auditLog.js';
import {
  startProductImprovementAgent,
  ingestNotebookLmResearch,
} from './agents/productImprovementAgent.js';

/** Practice-facing carrier labels for dashboard alerts (align with Admin carrier settings keys). */
const CARRIER_ALERT_LABELS: Record<string, string> = {
  sun_life: 'Sun Life Financial',
  canada_life: 'Canada Life',
  manulife: 'Manulife',
  green_shield: 'Green Shield Canada',
  rbc_insurance: 'RBC Insurance',
  telus_adjudicare: 'TELUS AdjudiCare',
};

initSentry();
assertJwtConfigAtStartup();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
  cors({
    origin: (origin, cb) => {
      const allowed = parseAllowedOrigins();
      if (!origin) return cb(null, true);
      return cb(null, allowed.includes(origin));
    },
    credentials: true,
  })
);
app.use(cookieParser());
app.use(requestMetricsAndAccessLog());

// Stripe webhooks need the raw body — must be registered before express.json()
app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    if (!sig || Array.isArray(sig)) {
      return res.status(400).json({ error: 'Missing stripe-signature' });
    }
    try {
      const body = req.body;
      if (!Buffer.isBuffer(body)) {
        return res.status(400).json({ error: 'Invalid body' });
      }
      const result = await handleWebhook(body, sig, prisma);
      return res.json({ ok: true, result });
    } catch (e) {
      console.error('Stripe webhook error', e);
      return res.status(400).json({ error: (e as Error).message || 'webhook error' });
    }
  }
);

// P4-05 — Vapi server URL (JSON + raw body for idempotency hash). Must be before global express.json().
app.post(
  '/api/vapi/webhook',
  express.json({
    limit: '2mb',
    verify: (req, _res, buf) => {
      (req as express.Request & { vapiRawBody?: Buffer }).vapiRawBody = buf;
    },
  }),
  async (req, res) => {
    try {
      await handleVapiWebhook(req as express.Request & { vapiRawBody?: Buffer }, res, prisma);
    } catch (e) {
      console.error('Vapi webhook error', e);
      if (!res.headersSent) {
        res.status(500).json({ error: (e as Error).message || 'Vapi webhook error' });
      }
    }
  }
);

// P4-03 — Twilio inbound SMS (form-encoded). Must be before global express.json().
app.post(
  '/api/twilio/sms',
  express.urlencoded({ extended: false }),
  async (req, res) => {
    try {
      await handleTwilioInboundSms(req, res, prisma);
    } catch (e) {
      console.error('Twilio inbound SMS error', e);
      if (!res.headersSent) {
        res.status(500).type('text/plain').send('Error');
      }
    }
  }
);

// P4-01 / P4-02 — SendGrid Event Webhook (signed; raw body)
app.post(
  '/api/webhooks/sendgrid',
  express.raw({ type: 'application/json', limit: '2mb' }),
  makeSendgridEventWebhookHandler(prisma)
);

app.use(express.json({ limit: '1mb' }));

/**
 * NotebookLM -> CollectRx bridge.
 * Intended caller: your external daily Claude/NotebookLM schedule.
 */
app.post('/api/internal/notebooklm/ingest', async (req, res) => {
  const expected = String(process.env.PRODUCT_AGENT_INGEST_TOKEN || '');
  if (!expected) {
    return res.status(503).json({ error: 'ingest_not_configured' });
  }
  const token =
    (typeof req.headers['x-collectrx-research-token'] === 'string' &&
      req.headers['x-collectrx-research-token']) ||
    '';
  if (!token || token !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const result = await ingestNotebookLmResearch(prisma, req.body as {
      title: string;
      sourceUrl?: string;
      findings: Array<{
        theme: string;
        finding: string;
        recommendedAction: string;
        urgency?: 'low' | 'medium' | 'high';
      }>;
      practiceId?: string;
    });
    return res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message || 'invalid_payload' });
  }
});

const uploadCsv = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// P3-22 — public patient pay (no staff cookie); token issued when Stripe link is created
app.get('/api/public/pay/:publicToken', async (req, res) => {
  try {
    const token = req.params.publicToken;
    if (!token || token.length > 80) {
      return res.status(400).json({ error: 'invalid token' });
    }
    const b = await prisma.patientBalance.findUnique({ where: { publicPayToken: token } });
    if (!b) {
      return res.status(404).json({ error: 'not_found' });
    }
    if (b.publicPayTokenExpiresAt && b.publicPayTokenExpiresAt < new Date()) {
      return res.status(410).json({
        error: 'expired',
        message: 'This payment link has expired. Please contact your dental office for a new link.',
      });
    }
    const amountDue = Math.max(0, Number(b.patientOwes) - Number(b.amountPaid || 0));
    const paid = amountDue < 0.01 || b.paymentStatus === 'paid';
    return res.json({
      paid,
      amountDue: paid ? 0 : amountDue,
      currency: 'CAD',
      stripeUrl: b.stripePaymentLink,
      firstName: b.patientFirstName,
    });
  } catch (e) {
    console.error('public pay', e);
    return res.status(500).json({ error: 'failed' });
  }
});

function publicUnsubscribeHtml(title: string, message: string) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>${title}</title><meta name="viewport" content="width=device-width, initial-scale=1"/></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem;line-height:1.5"><h1 style="font-size:1.25rem">${title}</h1><p>${message}</p></body></html>`;
}

// P4-02 — one-click email opt-out (no staff session; token is HMAC)
app.get('/api/public/email-unsubscribe', async (req, res) => {
  const b = String((req.query as { b?: string }).b || '');
  const e = String((req.query as { e?: string }).e || '');
  const s = String((req.query as { s?: string }).s || '');
  if (!b || !e || !s) {
    return res
      .status(400)
      .type('html')
      .send(publicUnsubscribeHtml('Invalid link', 'This unsubscribe link is missing required parameters.'));
  }
  if (!verifyUnsubscribeRequest(b, e, s)) {
    return res
      .status(400)
      .type('html')
      .send(
        publicUnsubscribeHtml('Invalid or expired link', 'This unsubscribe link is invalid. Contact your dental office to update your communication preferences.')
      );
  }
  try {
    const row = await prisma.patientBalance.findFirst({
      where: { id: b, patientEmail: { equals: e, mode: 'insensitive' } },
      select: { id: true, practiceId: true },
    });
    if (!row) {
      return res
        .status(404)
        .type('html')
        .send(
          publicUnsubscribeHtml(
            'No matching record',
            'We could not find this email address for that balance. If you still receive messages, contact your dental office.'
          )
        );
    }
    await prisma.patientBalance.update({ where: { id: row.id }, data: { emailOptOutAt: new Date() } });
    if (row.practiceId) {
      void appendAuditLog(prisma, {
        practiceId: row.practiceId,
        action: 'public.email_unsubscribe',
        subjectType: 'PatientBalance',
        subjectId: row.id,
        details: { channel: 'email_marketing' },
        req: req as express.Request,
      });
    }
    return res
      .status(200)
      .type('html')
      .send(
        publicUnsubscribeHtml(
          'Email preferences updated',
          'You will no longer receive balance reminder emails to this address from this system. For account questions, contact your dental office.'
        )
      );
  } catch (err) {
    console.error('email-unsubscribe', err);
    return res.status(500).type('html').send(publicUnsubscribeHtml('Error', 'Something went wrong. Please try again later or contact your dental office.'));
  }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many login attempts' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});
app.use(
  '/api/auth',
  (req, res, next) => {
    const base = (req.originalUrl || req.url || '').split('?')[0] || '';
    if (req.method === 'POST' && base === '/api/auth/login') {
      return loginLimiter(req, res, next);
    }
    return next();
  }
);

app.use(
  '/api',
  rateLimit({
    windowMs: 60_000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests' },
  })
);

const practiceId = (req: express.Request) => req.practiceAuth!.practiceId;

const protectedApi = express.Router();
protectedApi.use(authenticate);
protectedApi.use(createBenefitsApiRouter(prisma));
protectedApi.use(createPatientArApiRouter(prisma));
protectedApi.use(createCanadianExpansionRouter(prisma));

// Dashboard stats
protectedApi.get('/dashboard/stats', async (req, res) => {
  try {
    const pid = practiceId(req);
    const openBalances = await prisma.balance.findMany({
      where: { practiceId: pid, status: 'OPEN' },
      include: {
        states: { orderBy: { stageAt: 'desc' }, take: 1 },
      },
    });

    const totalOpenAR = openBalances.reduce((sum, b) => sum + b.amountCents, 0);
    const now = new Date();
    const aging = { '0-30': 0, '31-60': 0, '>60': 0 };
    const stageCounts: Record<string, number> = {};

    openBalances.forEach((balance) => {
      const daysOld = Math.floor(
        (now.getTime() - balance.createdAt.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysOld <= 30) aging['0-30'] += balance.amountCents;
      else if (daysOld <= 60) aging['31-60'] += balance.amountCents;
      else aging['>60'] += balance.amountCents;
      const currentStage = balance.states[0]?.stage || 'CREATED';
      stageCounts[currentStage] = (stageCounts[currentStage] || 0) + 1;
    });

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const [paymentsToday, weekPayments, recentPaymentEvents, practiceRow, connectRow] = await Promise.all([
      prisma.paymentEvent.count({
        where: {
          balance: { practiceId: pid },
          paidAt: { gte: startOfToday },
        },
      }),
      prisma.paymentEvent.findMany({
        where: {
          balance: { practiceId: pid },
          paidAt: { gte: weekAgo },
        },
        select: { amountCents: true },
      }),
      prisma.paymentEvent.findMany({
        where: { balance: { practiceId: pid } },
        orderBy: { paidAt: 'desc' },
        take: 8,
        include: {
          balance: { include: { patient: { select: { displayName: true } } } },
        },
      }),
      prisma.practice.findUnique({ where: { id: pid }, select: { settings: true } }),
      prisma.stripeConnectAccount.findUnique({ where: { practiceId: pid } }),
    ]);

    const revenueThisWeekCents = weekPayments.reduce((s, p) => s + p.amountCents, 0);
    const revenueTodayCents = await prisma.paymentEvent
      .aggregate({
        where: {
          balance: { practiceId: pid },
          paidAt: { gte: startOfToday },
        },
        _sum: { amountCents: true },
      })
      .then((a) => a._sum.amountCents ?? 0);

    const sk = process.env.STRIPE_SECRET_KEY;
    const patientPaymentsReady = !!(sk && connectRow?.chargesEnabled);
    const settings = practiceRow?.settings as { carriers?: Record<string, { block?: boolean }> } | null;
    const blockedCarriers: { code: string; name: string }[] = [];
    if (settings?.carriers && typeof settings.carriers === 'object') {
      for (const [code, flags] of Object.entries(settings.carriers)) {
        if (flags && typeof flags === 'object' && flags.block) {
          blockedCarriers.push({
            code,
            name: CARRIER_ALERT_LABELS[code] ?? code.replace(/_/g, ' '),
          });
        }
      }
    }

    res.json({
      totalOpenAR: totalOpenAR / 100,
      aging: {
        '0-30': aging['0-30'] / 100,
        '31-60': aging['31-60'] / 100,
        '>60': aging['>60'] / 100,
      },
      stageCounts,
      openBalanceCount: openBalances.length,
      /** P3-12 — real aggregates; no mock KPIs */
      claimsResolvedToday: paymentsToday,
      revenueToday: revenueTodayCents / 100,
      revenueThisWeek: revenueThisWeekCents / 100,
      /** Vapi / voice volume not stored yet — UI shows “not configured” */
      telephony: { callsPlacedToday: null, activeCalls: [] },
      recentPayments: recentPaymentEvents.map((e) => ({
        id: e.id,
        amount: e.amountCents / 100,
        paidAt: e.paidAt.toISOString(),
        patientLabel: e.balance.patient.displayName,
      })),
      /** Office-manager visibility: carrier blocks + payment readiness (see Office Guide). */
      operationalAlerts: {
        blockedCarriers,
        patientPaymentsReady,
      },
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

protectedApi.get('/analytics/collection-rate', async (req, res) => {
  try {
    const pid = practiceId(req);
    const allBalances = await prisma.balance.findMany({
      where: { practiceId: pid },
      include: {
        paymentEvents: true,
        states: { orderBy: { stageAt: 'asc' } },
      },
    });
    const paidBalances = allBalances.filter((b) => b.status === 'PAID');
    const openBalances = allBalances.filter((b) => b.status === 'OPEN');
    const totalBalances = allBalances.length;
    const collectionRate = totalBalances > 0 ? (paidBalances.length / totalBalances) * 100 : 0;
    const daysToPayment = paidBalances
      .map((b) => {
        const firstState = b.states[0];
        const payment = b.paymentEvents[0];
        if (!firstState || !payment) return 0;
        return Math.floor(
          (payment.paidAt.getTime() - firstState.stageAt.getTime()) / (1000 * 60 * 60 * 24)
        );
      })
      .filter((d) => d > 0);
    const avgDaysToPayment =
      daysToPayment.length > 0
        ? daysToPayment.reduce((a, b) => a + b, 0) / daysToPayment.length
        : 0;
    const totalCollected = paidBalances.reduce((sum, b) => sum + b.amountCents, 0);
    const totalOutstanding = openBalances.reduce((sum, b) => sum + b.amountCents, 0);
    res.json({
      collectionRate: Number(collectionRate.toFixed(2)),
      avgDaysToPayment: Number(avgDaysToPayment.toFixed(1)),
      totalCollected: totalCollected / 100,
      totalOutstanding: totalOutstanding / 100,
      paidCount: paidBalances.length,
      openCount: openBalances.length,
      totalCount: totalBalances,
    });
  } catch (error) {
    console.error('Collection rate error:', error);
    res.status(500).json({ error: 'Failed to fetch collection rate' });
  }
});

protectedApi.get('/analytics/stage-funnel', async (req, res) => {
  try {
    const pid = practiceId(req);
    const allBalances = await prisma.balance.findMany({
      where: { practiceId: pid },
      include: { states: { orderBy: { stageAt: 'asc' } } },
    });
    const stages = [
      'CREATED',
      'NOTIFIED',
      'REMINDER_1',
      'REMINDER_2',
      'ESCALATED',
      'STAFF_REVIEW',
      'CLOSED',
    ];
    const funnel: Array<{ stage: string; count: number; dropOff: number; dropOffRate: number }> = [];
    stages.forEach((stage, index) => {
      const reachedStage = allBalances.filter((b) => b.states.some((s) => s.stage === stage))
        .length;
      const previousStage = index > 0 ? funnel[index - 1].count : allBalances.length;
      const dropOff = previousStage - reachedStage;
      const dropOffRate = previousStage > 0 ? (dropOff / previousStage) * 100 : 0;
      funnel.push({
        stage,
        count: reachedStage,
        dropOff,
        dropOffRate: Number(dropOffRate.toFixed(2)),
      });
    });
    res.json({ funnel });
  } catch (error) {
    console.error('Stage funnel error:', error);
    res.status(500).json({ error: 'Failed to fetch stage funnel' });
  }
});

protectedApi.get('/analytics/priority-balances', async (req, res) => {
  try {
    const pid = practiceId(req);
    const balances = await prisma.balance.findMany({
      where: { practiceId: pid, status: 'OPEN' },
      include: {
        patient: true,
        states: { orderBy: { stageAt: 'desc' }, take: 1 },
      },
    });
    const now = new Date();
    const prioritized = balances.map((b) => {
      const daysOutstanding = Math.floor(
        (now.getTime() - b.createdAt.getTime()) / (1000 * 60 * 60 * 24)
      );
      const currentStage = b.states[0]?.stage || 'CREATED';
      const priorityScore = daysOutstanding * 10 + b.amountCents / 100;
      return { ...b, daysOutstanding, currentStage, priorityScore, amount: b.amountCents / 100 };
    });
    const top10 = prioritized.sort((a, b) => b.priorityScore - a.priorityScore).slice(0, 10);
    res.json({ priorityBalances: top10 });
  } catch (error) {
    console.error('Priority balances error:', error);
    res.status(500).json({ error: 'Failed to fetch priority balances' });
  }
});

protectedApi.get('/analytics/message-effectiveness', async (req, res) => {
  try {
    const pid = practiceId(req);
    const outreachEvents = await prisma.outreachEvent.findMany({
      where: { balance: { practiceId: pid } },
      include: { balance: { include: { paymentEvents: true } } },
    });
    const messageTypes = ['NOTIFIED', 'REMINDER_1', 'REMINDER_2', 'ESCALATED'];
    const effectiveness: Array<{
      messageType: string;
      totalSent: number;
      responded: number;
      paid: number;
      responseRate: number;
      paymentRate: number;
    }> = [];
    messageTypes.forEach((type) => {
      const messages = outreachEvents.filter((e) => e.templateKey === type);
      const totalSent = messages.length;
      const responded = messages.filter((e) => e.responseStatus !== 'NONE').length;
      const paid = messages.filter((e) => e.responseStatus === 'PAY').length;
      const responseRate = totalSent > 0 ? (responded / totalSent) * 100 : 0;
      const paymentRate = totalSent > 0 ? (paid / totalSent) * 100 : 0;
      effectiveness.push({
        messageType: type,
        totalSent,
        responded,
        paid,
        responseRate: Number(responseRate.toFixed(2)),
        paymentRate: Number(paymentRate.toFixed(2)),
      });
    });
    res.json({ effectiveness });
  } catch (error) {
    console.error('Message effectiveness error:', error);
    res.status(500).json({ error: 'Failed to fetch message effectiveness' });
  }
});

protectedApi.get('/analytics/payment-trends', async (req, res) => {
  try {
    const pid = practiceId(req);
    const paidBalances = await prisma.balance.findMany({
      where: { practiceId: pid, status: 'PAID' },
      include: {
        paymentEvents: { orderBy: { paidAt: 'desc' }, take: 1 },
        states: { orderBy: { stageAt: 'asc' }, take: 1 },
      },
    });
    const weeklyData: Record<string, { count: number; totalDays: number; totalAmount: number }> = {};
    paidBalances.forEach((b) => {
      const payment = b.paymentEvents[0];
      const firstState = b.states[0];
      if (!payment || !firstState) return;
      const paidDate = new Date(payment.paidAt);
      const weekStart = new Date(paidDate);
      weekStart.setDate(paidDate.getDate() - paidDate.getDay());
      const weekKey = weekStart.toISOString().split('T')[0];
      const daysToPayment = Math.floor(
        (payment.paidAt.getTime() - firstState.stageAt.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (!weeklyData[weekKey]) {
        weeklyData[weekKey] = { count: 0, totalDays: 0, totalAmount: 0 };
      }
      weeklyData[weekKey].count++;
      weeklyData[weekKey].totalDays += daysToPayment;
      weeklyData[weekKey].totalAmount += b.amountCents;
    });
    const trends = Object.entries(weeklyData)
      .map(([week, data]) => ({
        week,
        paymentsCount: data.count,
        avgDaysToPayment: Number((data.totalDays / data.count).toFixed(1)),
        totalAmount: data.totalAmount / 100,
      }))
      .sort((a, b) => a.week.localeCompare(b.week))
      .slice(-12);
    res.json({ trends });
  } catch (error) {
    console.error('Payment trends error:', error);
    res.status(500).json({ error: 'Failed to fetch payment trends' });
  }
});

const CARRIER_LABEL: Record<string, string> = {
  sun_life: 'Sun Life',
  canada_life: 'Canada Life',
  manulife: 'Manulife',
  green_shield: 'Green Shield',
  rbc_insurance: 'RBC Insurance',
  telus_adjudicare: 'TELUS AdjudiCare',
};

protectedApi.get('/analytics/carrier-performance', async (req, res) => {
  try {
    const pid = practiceId(req);
    const rows = await prisma.patientBalance.findMany({
      where: { practiceId: pid, carrierCode: { not: null } },
      select: { carrierCode: true, paymentStatus: true },
    });
    const map = new Map<string, { total: number; paid: number }>();
    for (const r of rows) {
      const c = r.carrierCode || 'unknown';
      const cur = map.get(c) || { total: 0, paid: 0 };
      cur.total += 1;
      if (r.paymentStatus === 'paid') cur.paid += 1;
      map.set(c, cur);
    }
    const performance = Array.from(map.entries())
      .map(([code, v]) => ({
        carrier: CARRIER_LABEL[code] || code,
        code,
        rate: v.total ? Math.round((v.paid / v.total) * 100) : 0,
        resolved: v.paid,
        total: v.total,
      }))
      .sort((a, b) => b.total - a.total);
    res.json({ performance, empty: performance.length === 0 });
  } catch (error) {
    console.error('Carrier performance error:', error);
    res.status(500).json({ error: 'Failed to fetch carrier performance' });
  }
});

/** Phase 2 — 8-dimension dashboard + CDCP / write-back counters + ITRANS 2 readiness */
protectedApi.get('/analytics/canadian-phase2', async (req, res) => {
  try {
    const pid = practiceId(req);
    const now = new Date();
    const [
      reconsiderationTotal,
      pipelineOpen,
      expiringSoon,
      writeback7d,
      writebackPending,
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
        where: { practiceId: pid, processedAt: null, processError: null },
      }),
      computeEightDimensions(prisma, pid),
    ]);
    res.json({
      reconsiderationCasesTotal: reconsiderationTotal,
      reconsiderationPipelineActive: pipelineOpen,
      reconsiderationWindowAttention: expiringSoon,
      pmsWritebacksLast7Days: writeback7d,
      pmsWritebacksPending: writebackPending,
      itrans2: getItransStatus(now),
      eightDimensions,
      eightDimensionLabels: eightDimensions.map((d) => ({ id: d.id, name: d.name })),
    });
  } catch (error) {
    console.error('Canadian phase2 analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch Canadian phase-2 metrics' });
  }
});

protectedApi.get('/balances', async (req, res) => {
  try {
    const pid = practiceId(req);
    const { stage, minAmount, maxAmount } = req.query;
    const balances = await prisma.balance.findMany({
      where: { practiceId: pid, status: 'OPEN' },
      include: { patient: true, states: { orderBy: { stageAt: 'desc' }, take: 1 } },
      orderBy: { createdAt: 'desc' },
    });
    let filtered = balances;
    if (stage) {
      filtered = filtered.filter((b) => b.states[0]?.stage === stage);
    }
    if (minAmount) {
      filtered = filtered.filter((b) => b.amountCents >= Number(minAmount) * 100);
    }
    if (maxAmount) {
      filtered = filtered.filter((b) => b.amountCents <= Number(maxAmount) * 100);
    }
    res.json(
      filtered.map((b) => ({
        ...b,
        amountCents: b.amountCents,
        amount: b.amountCents / 100,
        currentStage: b.states[0]?.stage || 'CREATED',
        daysOutstanding: Math.floor(
          (Date.now() - b.createdAt.getTime()) / (1000 * 60 * 60 * 24)
        ),
      }))
    );
  } catch (error) {
    console.error('Get balances error:', error);
    res.status(500).json({ error: 'Failed to fetch balances' });
  }
});

protectedApi.get('/balances/:id', async (req, res) => {
  try {
    const pid = practiceId(req);
    const balance = await prisma.balance.findFirst({
      where: { id: req.params.id, practiceId: pid },
      include: {
        patient: true,
        practice: { select: { id: true, name: true } },
        states: { orderBy: { stageAt: 'asc' } },
        outreachEvents: { orderBy: { sentAt: 'asc' } },
        paymentEvents: { orderBy: { paidAt: 'asc' } },
      },
    });
    if (!balance) {
      return res.status(404).json({ error: 'Balance not found' });
    }
    res.json({
      ...balance,
      amount: balance.amountCents / 100,
      daysOutstanding: Math.floor(
        (Date.now() - balance.createdAt.getTime()) / (1000 * 60 * 60 * 24)
      ),
    });
  } catch (error) {
    console.error('Get balance detail error:', error);
    res.status(500).json({ error: 'Failed to fetch balance details' });
  }
});

protectedApi.get('/outreach', async (req, res) => {
  try {
    const pid = practiceId(req);
    const events = await prisma.outreachEvent.findMany({
      where: { balance: { practiceId: pid } },
      include: { balance: { include: { patient: true } } },
      orderBy: { sentAt: 'desc' },
      take: 100,
    });
    res.json(events);
  } catch (error) {
    console.error('Get outreach events error:', error);
    res.status(500).json({ error: 'Failed to fetch outreach events' });
  }
});

protectedApi.post('/outreach/:id/respond', async (req, res) => {
  try {
    const pid = practiceId(req);
    const { responseType } = req.body;
    const event = await prisma.outreachEvent.findFirst({
      where: { id: req.params.id },
      include: { balance: true },
    });
    if (!event) {
      return res.status(404).json({ error: 'Outreach event not found' });
    }
    if (event.balance.practiceId !== pid) {
      return res.status(404).json({ error: 'Outreach event not found' });
    }
    await prisma.outreachEvent.update({
      where: { id: event.id },
      data: { responseStatus: responseType },
    });
    if (responseType === 'PAY') {
      await prisma.paymentEvent.create({
        data: {
          balanceId: event.balanceId,
          amountCents: event.balance.amountCents,
          method: 'LINK',
          result: 'SUCCESS',
        },
      });
      await prisma.balance.update({
        where: { id: event.balanceId },
        data: { status: 'PAID' },
      });
      await prisma.balanceState.create({
        data: { balanceId: event.balanceId, stage: 'CLOSED' },
      });
    } else if (responseType === 'DISPUTE') {
      await prisma.balance.update({
        where: { id: event.balanceId },
        data: { status: 'IN_DISPUTE' },
      });
      await prisma.balanceState.create({
        data: { balanceId: event.balanceId, stage: 'STAFF_REVIEW' },
      });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Respond to outreach error:', error);
    res.status(500).json({ error: 'Failed to process response' });
  }
});

protectedApi.post('/pay/:balanceId', async (req, res) => {
  try {
    const pid = practiceId(req);
    const balance = await prisma.balance.findFirst({
      where: { id: req.params.balanceId, practiceId: pid },
    });
    if (!balance) {
      return res.status(404).json({ error: 'Balance not found' });
    }
    await prisma.paymentEvent.create({
      data: { balanceId: balance.id, amountCents: balance.amountCents, method: 'LINK', result: 'SUCCESS' },
    });
    await prisma.balance.update({ where: { id: balance.id }, data: { status: 'PAID' } });
    await prisma.balanceState.create({ data: { balanceId: balance.id, stage: 'CLOSED' } });
    res.json({ success: true });
  } catch (error) {
    console.error('Payment error:', error);
    res.status(500).json({ error: 'Payment failed' });
  }
});

protectedApi.post('/admin/generate-balances', async (req, res) => {
  try {
    const pid = practiceId(req);
    const count = Number((req.body as { count?: number })?.count ?? 50) || 50;
    const patients = await prisma.patient.findMany({ where: { practiceId: pid } });
    if (patients.length === 0) {
      return res.status(400).json({ error: 'No patients found. Run seed first.' });
    }
    const balances = [];
    const now = new Date();
    for (let i = 0; i < count; i++) {
      const patient = patients[Math.floor(Math.random() * patients.length)];
      const daysAgo = Math.floor(Math.random() * 45);
      const createdAt = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
      const dueDate = new Date(createdAt.getTime() + 30 * 24 * 60 * 60 * 1000);
      const amountCents = Math.floor(Math.random() * 100000) + 5000;
      const balance = await prisma.balance.create({
        data: {
          practiceId: pid,
          patientId: patient.id,
          amountCents,
          createdAt,
          dueDate,
          status: 'OPEN',
          source: 'DENTRIX_SYNC',
          lastDentrixSyncAt: createdAt,
        },
      });
      await prisma.balanceState.create({
        data: { balanceId: balance.id, stage: 'CREATED', stageAt: createdAt },
      });
      balances.push(balance);
    }
    const n = balances.length;
    void appendAuditLog(prisma, {
      practiceId: pid,
      action: 'admin.generate_balances',
      details: { count: n },
      req: req as express.Request,
    });
    res.json({
      success: true,
      count: n,
      message: `Generated ${n} synthetic balances`,
    });
  } catch (error) {
    console.error('Generate balances error:', error);
    res.status(500).json({ error: 'Failed to generate balances' });
  }
});

protectedApi.get('/admin/settings', async (req, res) => {
  try {
    const pid = practiceId(req);
    const row = await prisma.practice.findUnique({
      where: { id: pid },
      select: { settings: true },
    });
    res.json({ settings: row?.settings ?? null });
  } catch (e) {
    console.error('admin settings GET', e);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

protectedApi.put('/admin/settings', async (req, res) => {
  try {
    const pid = practiceId(req);
    const body = req.body as { settings?: unknown };
    if (body.settings === undefined) {
      return res.status(400).json({ error: 'settings object is required' });
    }
    if (body.settings !== null && typeof body.settings !== 'object') {
      return res.status(400).json({ error: 'settings must be a JSON object or null' });
    }
    const row = await prisma.practice.update({
      where: { id: pid },
      data: { settings: body.settings as object },
      select: { settings: true },
    });
    const st = body.settings as Record<string, unknown> | null;
    const topKeys = st && typeof st === 'object' ? Object.keys(st) : [];
    void appendAuditLog(prisma, {
      practiceId: pid,
      action: 'admin.settings.update',
      subjectType: 'Practice',
      subjectId: pid,
      details: { topLevelKeys: topKeys },
      req: req as express.Request,
    });
    res.json({ settings: row.settings });
  } catch (e) {
    console.error('admin settings PUT', e);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

/** P5-04: recent staff-side changes (append-only; no read tracking). */
protectedApi.get('/admin/audit-log', async (req, res) => {
  try {
    const pid = practiceId(req);
    const limit = Math.min(100, Math.max(1, parseInt(String((req.query as { limit?: string }).limit || '50'), 10) || 50));
    const entries = await prisma.auditLog.findMany({
      where: { practiceId: pid },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        action: true,
        subjectType: true,
        subjectId: true,
        details: true,
        requestIp: true,
        userAgent: true,
      },
    });
    return res.json({ entries });
  } catch (e) {
    console.error('admin/audit-log', e);
    return res.status(500).json({ error: 'Failed to load audit log' });
  }
});

/** P4-08 / Phase 4 go-live: env + Stripe Connect surface (no secret values). */
protectedApi.get('/admin/integrations', async (req, res) => {
  try {
    const pid = practiceId(req);
    const sk = process.env.STRIPE_SECRET_KEY;
    const connect = await prisma.stripeConnectAccount.findUnique({ where: { practiceId: pid } });
    const hasSendgrid = !!process.env.SENDGRID_API_KEY;
    const hasTwilio =
      !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN && !!process.env.TWILIO_FROM_NUMBER;
    const hasEscalationStaffPhone = !!String(process.env.ESCALATION_STAFF_PHONE || '').trim();
    return res.json({
      sendgrid: {
        apiKey: hasSendgrid,
        fromEmail: !!process.env.SENDGRID_FROM_EMAIL,
        eventWebhookVerifyKey: !!process.env.SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY,
      },
      twilio: {
        apiAndFrom: hasTwilio,
        inboundUrlForSignature: !!process.env.TWILIO_SMS_INBOUND_URL,
      },
      escalation: {
        staffPhone: hasEscalationStaffPhone,
        immediateStaffNotify: hasTwilio && hasEscalationStaffPhone,
        voiceRing: String(process.env.ESCALATION_STAFF_VOICE_RING || 'urgent').toLowerCase(),
      },
      stripe: {
        secretKey: !!sk,
        testMode: sk ? sk.startsWith('sk_test_') : false,
      },
      stripeConnect: {
        account: !!connect,
        onboardingComplete: connect?.onboardingComplete ?? false,
        chargesEnabled: connect?.chargesEnabled ?? false,
      },
      vapi: {
        webhookSecret: !!process.env.VAPI_WEBHOOK_SECRET,
      },
      email: {
        unsubscribeHmac: !!(process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.JWT_SECRET),
        publicApiBase: getPublicApiBase(),
      },
    });
  } catch (e) {
    console.error('admin/integrations', e);
    return res.status(500).json({ error: 'Failed to load integration status' });
  }
});

protectedApi.post('/admin/import-patient-csv', uploadCsv.single('file'), async (req, res) => {
  try {
    const file = (req as express.Request & { file?: { buffer: Buffer; originalname?: string } }).file;
    if (!file?.buffer) {
      return res.status(400).json({ error: 'Multipart field "file" is required (text/csv)' });
    }
    const pid = practiceId(req);
    const rows = parseSimpleCsv(file.buffer.toString('utf-8')) as Parameters<typeof upsertBalances>[0];
    if (rows.length === 0) {
      return res.status(400).json({
        error: 'No data rows: provide a header row and at least one non-empty data row',
      });
    }
    const results = await upsertBalances(rows as never, pid);
    void appendAuditLog(prisma, {
      practiceId: pid,
      action: 'admin.csv_import',
      details: {
        imported: results.imported,
        updated: results.updated,
        skipped: results.skipped,
        errorCount: results.errors.length,
        fileBytes: file.buffer.length,
      },
      req: req as express.Request,
    });
    res.json({ ok: true, ...results });
  } catch (e) {
    console.error('CSV import', e);
    res.status(500).json({ error: 'Import failed' });
  }
});

protectedApi.get('/practices', async (req, res) => {
  try {
    const p = await prisma.practice.findUnique({
      where: { id: practiceId(req) },
      select: { id: true, name: true, timezone: true },
    });
    res.json(p ? [p] : []);
  } catch (error) {
    console.error('Get practices error:', error);
    res.status(500).json({ error: 'Failed to fetch practices' });
  }
});

protectedApi.get('/rules', async (req, res) => {
  try {
    const ruleSets = await prisma.ruleSet.findMany({
      where: { practiceId: practiceId(req), isActive: true },
      include: { rules: true },
    });
    res.json(ruleSets);
  } catch (error) {
    console.error('Get rules error:', error);
    res.status(500).json({ error: 'Failed to fetch rules' });
  }
});

protectedApi.put('/rules/:id', async (req, res) => {
  try {
    const pid = practiceId(req);
    const { conditions, actionParams } = req.body;
    const existing = await prisma.rule.findFirst({
      where: { id: req.params.id },
      include: { ruleSet: true },
    });
    if (!existing || existing.ruleSet.practiceId !== pid) {
      return res.status(404).json({ error: 'Rule not found' });
    }
    const rule = await prisma.rule.update({
      where: { id: req.params.id },
      data: {
        conditions: JSON.stringify(conditions),
        actionParams: JSON.stringify(actionParams),
      },
    });
    void appendAuditLog(prisma, {
      practiceId: pid,
      action: 'rules.update',
      subjectType: 'Rule',
      subjectId: rule.id,
      details: { ruleSetId: existing.ruleSetId },
      req: req as express.Request,
    });
    res.json(rule);
  } catch (error) {
    console.error('Update rule error:', error);
    res.status(500).json({ error: 'Failed to update rule' });
  }
});

const VALID_CARRIERS = [
  'sun_life',
  'canada_life',
  'manulife',
  'green_shield',
  'rbc_insurance',
  'telus_adjudicare',
] as const;

const ALL_CARRIERS = [...VALID_CARRIERS] as string[];

protectedApi.post('/queue/priority', async (req, res) => {
  const { carrier, date } = req.body as { carrier: string | null; date: string };
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  if (carrier && !VALID_CARRIERS.includes(carrier as (typeof VALID_CARRIERS)[number])) {
    return res
      .status(400)
      .json({ error: `carrier must be one of: ${VALID_CARRIERS.join(', ')} or null` });
  }
  try {
    const pid = practiceId(req);
    const priorityDate = new Date(date + 'T00:00:00.000Z');
    const record = await prisma.queuePriority.upsert({
      where: { practiceId_priorityDate: { practiceId: pid, priorityDate } },
      update: { carrier: carrier ?? null },
      create: { practiceId: pid, carrier: carrier ?? null, priorityDate },
    });
    res.json({ ok: true, carrier: record.carrier, date });
  } catch (error) {
    console.error('Queue priority POST error:', error);
    res.status(500).json({ error: 'Failed to set queue priority' });
  }
});

protectedApi.get('/queue/priority', async (req, res) => {
  const date = (req.query.date as string) ?? new Date().toISOString().split('T')[0];
  try {
    const pid = practiceId(req);
    const priorityDate = new Date(date + 'T00:00:00.000Z');
    const record = await prisma.queuePriority.findUnique({
      where: { practiceId_priorityDate: { practiceId: pid, priorityDate } },
    });
    res.json({ carrier: record?.carrier ?? null, date });
  } catch (error) {
    console.error('Queue priority GET error:', error);
    res.status(500).json({ error: 'Failed to fetch queue priority' });
  }
});

protectedApi.get('/queue/carrier-order', async (req, res) => {
  try {
    const pid = practiceId(req);
    const record = await prisma.carrierOrder.findUnique({ where: { practiceId: pid } });
    const order: string[] = record ? JSON.parse(record.order) : [...ALL_CARRIERS];
    res.json({ practiceId: pid, order });
  } catch (error) {
    console.error('Carrier order GET error:', error);
    res.status(500).json({ error: 'Failed to fetch carrier order' });
  }
});

protectedApi.post('/queue/carrier-order', async (req, res) => {
  const { order } = req.body as { order: string[] };
  if (!Array.isArray(order) || order.length === 0) {
    return res.status(400).json({ error: 'order must be a non-empty array of carrier codes' });
  }
  const invalid = order.filter((c) => !ALL_CARRIERS.includes(c));
  if (invalid.length) {
    return res.status(400).json({ error: `Unknown carrier codes: ${invalid.join(', ')}` });
  }
  try {
    const pid = practiceId(req);
    const record = await prisma.carrierOrder.upsert({
      where: { practiceId: pid },
      update: { order: JSON.stringify(order) },
      create: { practiceId: pid, order: JSON.stringify(order) },
    });
    res.json({ practiceId: pid, order: JSON.parse(record.order) });
  } catch (error) {
    console.error('Carrier order POST error:', error);
    res.status(500).json({ error: 'Failed to save carrier order' });
  }
});

/** P6-04: liveness — use for load balancer; no DB. */
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'collectrx-api', timestamp: new Date().toISOString() });
});
/** P6-04: readiness — DB reachable (use for “full stack up” checks). */
app.get('/api/health/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ status: 'ready', database: 'ok', timestamp: new Date().toISOString() });
  } catch {
    return res.status(503).json({
      status: 'not_ready',
      database: 'unavailable',
      timestamp: new Date().toISOString(),
    });
  }
});
/** P6-03: in-process request/error/latency counters; point full APM at Sentry or your vendor in prod. */
app.get('/api/health/metrics', (_req, res) => {
  res.json(getMetrics());
});
/** P8-03: BullMQ queue depth (when REDIS_URL is set on this process). */
app.get('/api/health/queue', async (_req, res) => {
  if (!process.env.REDIS_URL) {
    return res.json({
      mode: 'in_process',
      message: 'REDIS_URL not set; rules and reminders run inside the API process (set REDIS_URL + run npm run worker to use a queue).',
    });
  }
  try {
    const { getQueueJobCounts } = await import('./jobs/arQueue.js');
    const counts = await getQueueJobCounts();
    return res.json({ mode: 'redis', service: 'collectrx-ar', timestamp: new Date().toISOString(), ...counts });
  } catch (e) {
    return res.status(503).json({
      mode: 'redis',
      error: 'queue_unavailable',
      message: (e as Error).message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Phase 2 — Law 25 / AIDA copy + ITRANS readiness are static / env-driven (no PHI).
 * Must be public so smoke tests, load balancers, and curl checks work without a session.
 */
app.get('/api/canadian/compliance/disclosures', (_req, res) => {
  res.json(getComplianceDisclosures());
});
app.get('/api/canadian/itrans2/status', (_req, res) => {
  res.json(getItransStatus());
});

app.use('/api/auth', createAuthRouter(prisma));
app.use('/api', protectedApi);
app.use('/api/eligibility', authenticate, createEligibilityRouter(prisma));

const distPath = path.join(process.cwd(), 'dist');
app.use(express.static(distPath));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  const indexPath = path.join(distPath, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      console.error('Error serving index.html:', err, 'Path:', indexPath);
      res.status(404).send('Frontend not found. API available at /api/health');
    }
  });
});

installSentryExpressErrorHandler(app);
if (!isSentryEnabled()) {
  app.use(
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (res.headersSent) {
        return;
      }
      const msg = err instanceof Error ? err.message : 'Internal server error';
      console.error('unhandled', err);
      return res
        .status(500)
        .json({ error: 'Internal server error', message: process.env.NODE_ENV === 'development' ? msg : undefined });
    }
  );
}

if (!process.env.VITEST) {
  app.listen(PORT, () => {
    markBoot();
    console.log(`✅ Server running on port ${PORT}`);
    console.log('📁 Static files from:', distPath);
    void (async () => {
      const disableSched = process.env.DISABLE_SCHEDULER === '1' || process.env.DISABLE_SCHEDULER === 'true';
      if (process.env.REDIS_URL) {
        if (disableSched) {
          console.log('⏸️  DISABLE_SCHEDULER set — not registering Bull repeatables (use a single scheduler or run worker + manual jobs).');
        } else {
          try {
            const { registerArJobSchedulers } = await import('./jobs/registerSchedulers.js');
            await registerArJobSchedulers();
            console.log('✅ BullMQ repeatables registered (start `npm run worker` in another process).');
          } catch (e) {
            console.error('❌ registerArJobSchedulers failed', e);
          }
        }
      } else {
        startRulesEngine(prisma);
        startReminderEngine();
        startProductImprovementAgent(prisma);
        console.log('✅ Rules + reminder engines in-process (no REDIS_URL).');
      }
    })();
  });
}

export { app, prisma };
