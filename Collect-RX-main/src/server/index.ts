// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Express Backend Server
// Port: 3001 (Railway)
//
// Route map:
//   /api/auth/*            authRoutes.ts (login, logout, me)
//   /api/insurance/*       insurance.ts  (claims, queue)
//   /api/calls/*           calls.ts
//   /api/carriers/*        carriers.ts
//   /api/analytics/*       analytics.ts (insurance + patient AR KPIs)
//   /api/balances*        balancesOutreachRoutes.ts (insurance Balance + outreach + POST /pay sim)
//   /api/benefits/*       benefitsApi.ts (pre-treatment benefits + estimate)
//   /api/patients/*        patientArApi.ts (patient balances, reminders, pay links)
//   /api/dashboard/*       dashboardRoutes.ts (ops stats)
//   /api/admin/*           adminRoutes.ts (settings, integrations, audit, CSV)
//   /api/eligibility/*     eligibility.ts
//   /api/cdcp/*            cdcp.ts (Phase 5: CDCP reconsideration, evidence gap, fee ceiling)
//   /api/queue/*          queue.ts (priority scores + carrier-order persistence)
//   /api/public/*        publicPatientPayRoutes.ts (public pay token, email unsubscribe — no auth)
//   /api/webhooks/vapi     webhooks/vapi.ts (raw body — mounted before json())
//   /api/webhooks/sendgrid sendgrid/handleSendgridEventWebhook.ts (raw JSON body)
//   /api/twilio/sms        twilio/inboundSms.ts (urlencoded — after body parsers)
//
// Safety:
//   - Webhook route uses raw body parser (HMAC validation requires raw bytes)
//   - All other routes use express.json()
//   - Prisma client is singleton from lib/prisma.ts
//   - piiVault.purgeExpired() runs on boot and hourly
//   - Rate limiting: standardLimiter on all /api/*, webhookLimiter on webhooks,
//     healthLimiter on /health + /api/health/*, authLimiter (5/15min) on POST /api/auth/login
//     (when REDIS_URL is set, limiters use Redis so counts are shared across API replicas)
//   - trust proxy: enabled in production (or TRUST_PROXY=1) so req.ip + limits are client-accurate
//   - Insurance, calls, analytics, carriers, queue, eligibility: require practice JWT (cookie or Bearer)
//   - VAPI_WEBHOOK_SECRET required in production — server refuses to start without it
//   - SendGrid: SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY required in production (401 otherwise)
//   - Stripe Connect onboard refresh/complete: ?v= HMAC (or same-practice JWT); see STRIPE_ONBOARD_RETURN_SECRET
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import { resolveCorsAllowedOrigins } from './corsAllowedOrigins';
import { prisma } from '../lib/prisma';
import { piiVault } from '../services/pii-vault';
import { assertJwtConfigAtStartup } from './authToken';
import {
  standardLimiter,
  webhookLimiter,
  healthLimiter,
} from './middleware/rateLimiter';

// Routes
import { createAuthRouter }  from './routes/authRoutes';
import insuranceRouter        from '../routes/insurance';
import callsRouter            from '../routes/calls';
import carriersRouter         from '../routes/carriers';
import analyticsRouter        from '../routes/analytics';
import eligibilityRouter      from '../routes/eligibility';
import queueRouter              from '../routes/queue';
import vapiWebhookRouter      from '../webhooks/vapi';
import { createPatientArApiRouter } from './routes/patientArApi';
import { createBalancesOutreachRouter } from './routes/balancesOutreachRoutes';
import { createPublicPatientPayRouter } from './routes/publicPatientPayRoutes';
import { createBenefitsApiRouter } from './routes/benefitsApi';
import dashboardRouter from './routes/dashboardRoutes';
import adminRouter from './routes/adminRoutes';
import pmsSyncRouter from './routes/pmsSyncRoutes.js';
import workQueueRouter from '../routes/workQueue.js';
import { createCdcpRouter } from './routes/cdcp.js';
import { stripeWebhookHandler, createStripeConnectRouter } from './routes/stripeApiRoutes';
import { createBillingRouter } from './routes/billingRoutes';
import { registerArJobSchedulers } from './jobs/registerSchedulers.js';
import { getMetrics } from './observability/metrics.js';
import { makeSendgridEventWebhookHandler } from './sendgrid/handleSendgridEventWebhook.js';
import { handleTwilioInboundSms } from './twilio/inboundSms.js';
const app = express();
const PORT = parseInt(process.env.PORT ?? '3000', 10);

// Behind Railway / other reverse proxies, trust X-Forwarded-* so req.ip and rate limits are per-client.
if (
  process.env.TRUST_PROXY === '1' ||
  process.env.TRUST_PROXY === 'true' ||
  process.env.NODE_ENV === 'production'
) {
  app.set('trust proxy', 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// VAPI_WEBHOOK_SECRET guard
// In production, refuse to start without the secret — a missing secret means
// anyone can POST forged Vapi events to the server.
// ─────────────────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production' && !process.env.VAPI_WEBHOOK_SECRET) {
  console.error(
    '[server] FATAL: VAPI_WEBHOOK_SECRET is not set in production. ' +
    'Set this env var in Railway to enable webhook signature verification. Refusing to start.',
  );
  process.exit(1);
}
if (!process.env.VAPI_WEBHOOK_SECRET) {
  console.warn(
    '[server] WARNING: VAPI_WEBHOOK_SECRET is not set. ' +
    'Webhook signature verification is DISABLED. Set this in production.',
  );
}

try {
  assertJwtConfigAtStartup();
} catch (e) {
  console.error('[server] FATAL:', (e as Error).message);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// CORS — see corsAllowedOrigins.ts (collectrx.ca apex ↔ www mirrored when one is set)
// ─────────────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: resolveCorsAllowedOrigins(),
  credentials: true,
}));

// ─────────────────────────────────────────────────────────────────────────────
// Stripe — webhook requires raw body (same signing secret as Connect + Billing)
// ─────────────────────────────────────────────────────────────────────────────
app.post(
  '/api/stripe/webhook',
  webhookLimiter,
  express.raw({ type: 'application/json' }),
  stripeWebhookHandler(prisma),
);

// ─────────────────────────────────────────────────────────────────────────────
// Vapi webhook — RAW body MUST be mounted before express.json()
// HMAC validation requires access to the raw request body bytes.
// webhookLimiter allows 300 req/min to handle Vapi event bursts.
// ─────────────────────────────────────────────────────────────────────────────
app.use(
  '/api/webhooks/vapi',
  webhookLimiter,
  express.raw({ type: 'application/json' }),
  vapiWebhookRouter,
);

app.post(
  '/api/webhooks/sendgrid',
  webhookLimiter,
  express.raw({ type: 'application/json' }),
  makeSendgridEventWebhookHandler(prisma),
);

// ─────────────────────────────────────────────────────────────────────────────
// Standard middleware
// ─────────────────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.post('/api/twilio/sms', webhookLimiter, (req, res, next) => {
  handleTwilioInboundSms(req, res, prisma).catch(next);
});

// ─────────────────────────────────────────────────────────────────────────────
// Health — excluded from /api rate limiting (tests + probes)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/health', healthLimiter, (_req: Request, res: Response) => {
  res.json({ status: 'ok', ts: new Date().toISOString(), service: 'collectrx-api' });
});

app.get('/api/health', healthLimiter, (_req: Request, res: Response) => {
  res.json({ status: 'ok', ts: new Date().toISOString(), service: 'collectrx-api' });
});

app.get('/api/health/ready', healthLimiter, async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'not_ready' });
  }
});

app.get('/api/health/metrics', healthLimiter, (_req: Request, res: Response) => {
  res.json({ success: true, metrics: getMetrics() });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting — baseline for all /api/* routes.
// authLimiter (stricter) is applied inside authRoutes.ts on POST /login.
// ─────────────────────────────────────────────────────────────────────────────
app.use('/api', standardLimiter);

// ─────────────────────────────────────────────────────────────────────────────
// API routes
// ─────────────────────────────────────────────────────────────────────────────
app.use('/api/auth',       createAuthRouter(prisma));
app.use('/api/billing',    createBillingRouter(prisma));
app.use('/api/stripe',     createStripeConnectRouter(prisma));
app.use('/api/insurance',  insuranceRouter);
app.use('/api/calls',      callsRouter);
app.use('/api/carriers',   carriersRouter);
app.use('/api/analytics',  analyticsRouter);
app.use('/api/eligibility', eligibilityRouter);
app.use('/api/queue',       queueRouter);
app.use('/api',            createPublicPatientPayRouter(prisma));
app.use('/api',            createBalancesOutreachRouter(prisma));
app.use('/api',            createBenefitsApiRouter(prisma));
app.use('/api',            createPatientArApiRouter(prisma));
app.use('/api/dashboard',  dashboardRouter);
app.use('/api/admin',      adminRouter);
app.use('/api/admin/sync', pmsSyncRouter);
app.use('/api/work-queue', workQueueRouter);
// Phase 5: CDCP Reconsideration & High-Precision Adjudication
app.use('/api/cdcp',       createCdcpRouter(prisma));

// ─────────────────────────────────────────────────────────────────────────────
// Serve React frontend (SPA catch-all)
// Vite builds to dist/ at the package root. Any non-API request gets the React
// app so client-side routing works correctly in production.
// ─────────────────────────────────────────────────────────────────────────────
const distPath = new URL('../../dist', import.meta.url).pathname;
const indexHtmlPath = new URL('../../dist/index.html', import.meta.url).pathname;

let cachedSpaIndexHtml: string | null = null;

function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** SPA shell HTML with optional `<meta name="crx-public-api-origin">` for split static/API deployments. */
function getSpaIndexHtml(): string {
  if (cachedSpaIndexHtml !== null) return cachedSpaIndexHtml;
  const raw = fs.readFileSync(indexHtmlPath, 'utf8');
  const api = (process.env.PUBLIC_API_BASE_URL || '').trim().replace(/\/$/, '');
  if (api) {
    const meta = `<meta name="crx-public-api-origin" content="${escapeHtmlAttr(api)}" />`;
    cachedSpaIndexHtml = /name="crx-public-api-origin"/i.test(raw)
      ? raw.replace(/<meta\s+name="crx-public-api-origin"[^>]*>/i, meta)
      : raw.replace('</head>', `${meta}\n</head>`);
  } else {
    cachedSpaIndexHtml = raw;
  }
  return cachedSpaIndexHtml;
}

app.use(express.static(distPath));
app.get('*', (req: Request, res: Response) => {
  if (req.path.startsWith('/api')) {
    res.status(404).json({ success: false, error: 'Not found' });
    return;
  }
  res.type('html').send(getSpaIndexHtml());
});

// ─────────────────────────────────────────────────────────────────────────────
// 404 fallback (only reached if dist/ is missing)
// ─────────────────────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

// ─────────────────────────────────────────────────────────────────────────────
// Global error handler
// ─────────────────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Boot (only when this file is the process entry — not when imported by tests)
// ─────────────────────────────────────────────────────────────────────────────
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

async function boot() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('[server] Database connected');
  } catch (err) {
    console.error('[server] Database connection failed:', err);
    process.exit(1);
  }

  piiVault.purgeExpired();
  setInterval(() => {
    const purged = piiVault.purgeExpired();
    if (purged > 0) console.log(`[piiVault] Purged ${purged} expired tokens`);
  }, 60 * 60 * 1000);

  if (process.env.REDIS_URL) {
    registerArJobSchedulers().catch((err) => {
      console.error('[server] registerArJobSchedulers failed:', (err as Error).message);
    });
  }

  const server = app.listen(PORT, () => {
    console.log(`[server] CollectRx API listening on port ${PORT}`);
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[server] Port ${PORT} is already in use. Stop the other process:\n` +
          `  lsof -nP -iTCP:${PORT} -sTCP:LISTEN\n` +
          `Or set PORT (and API_PORT for Vite proxy) in Collect-RX-main/.env`,
      );
      process.exit(1);
    }
    throw err;
  });
}

if (isMainModule()) {
  boot().catch((err) => {
    console.error('[server] Fatal boot error:', err);
    process.exit(1);
  });

  process.on('SIGTERM', async () => {
    console.log('[server] SIGTERM received — shutting down gracefully');
    await prisma.$disconnect();
    process.exit(0);
  });
}

export { app, prisma };
export default app;
