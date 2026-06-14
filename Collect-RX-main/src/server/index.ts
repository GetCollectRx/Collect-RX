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
//   /api/telemetry/*       productTelemetry.ts (ClickHouse usage SDK — optional)
//   /api/balances*        balancesOutreachRoutes.ts (insurance Balance + outreach + POST /pay sim)
//   /api/benefits/*       benefitsApi.ts (pre-treatment benefits + estimate)
//   /api/patients/*        patientArApi.ts (patient balances, reminders, pay links)
//   /api/dashboard/*       dashboardRoutes.ts (ops stats)
//   /api/admin/*           adminRoutes.ts (settings, integrations, audit, CSV)
//   /api/eligibility/*     eligibility.ts
//   /api/cdcp/*            cdcp.ts (Phase 5: CDCP reconsideration, evidence gap, fee ceiling)
//   /api/queue/*          queue.ts (priority scores + carrier-order persistence)
//   /api/public/*        publicPatientPayRoutes.ts (pay token + unsubscribe; publicLimiter 60/min)
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
//   - PostgreSQL: in production DATABASE_URL must require TLS (sslmode=require or stricter); see databaseTls.ts
//   - Helmet (HSTS, etc.); CSP off for Vite SPA — tighten if you serve only JSON from this process
//   - Optional Node HTTPS: TLS_KEY_PATH + TLS_CERT_PATH → strict TLS 1.2+ (else HTTP behind proxy TLS)
//   - GET /api/health/metrics: deployment fingerprint redacted in production unless HEALTH_METRICS_TOKEN + Bearer header
//   - EMR_SYNC_WEBHOOK_URL validated at boot (prod) and each outbox batch — https + non-internal host in production
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import { applyPostgresTlsToProcessEnv } from './databaseTls.js';

// Before Prisma reads DATABASE_URL (Railway URLs often omit ?sslmode=require).
applyPostgresTlsToProcessEnv();

import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { resolveCorsAllowedOrigins } from './corsAllowedOrigins';
import { prisma } from '../lib/prisma';
import { piiVault } from '../services/pii-vault';
import { assertJwtConfigAtStartup } from './authToken';
import { assertPostgresTlsInProduction } from './databaseTls';
import { assertPhiEncryptionAtRestConfigured } from './crypto/phiEncryptionKey.js';
import { assertEmrSyncWebhookUrlConfiguredAtBoot } from './emrWebhookUrl.js';
import { buildPublicHealthMetricsBody } from './healthMetricsExposure.js';
import { startOpsMonitor } from './observability/opsMonitor.js';
import { runStartupScanOnBoot } from './observability/runStartupScan.js';
import { loadTlsCredentialsForNodeServer } from './tls/nodeHttpsSettings.js';
import {
  assertResourcePagesBuilt,
  createResourceStaticMiddleware,
} from './resourceStatic.js';
import {
  sessionStandardLimiter,
  anonStandardLimiter,
  webhookLimiter,
  healthLimiter,
  telemetryEventsLimiter,
} from './middleware/rateLimiter';
import productTelemetryRouter from './routes/productTelemetry.js';
import { runTelemetryMigrations } from './productAnalytics/schema.js';
import { pingClickHouse, isClickHouseMockMode } from './productAnalytics/clickhouse.js';

// Routes
import { createAuthRouter }  from './routes/authRoutes';
import { createGroupAdminRouter } from './routes/groupAdminRoutes';
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
import pmsApiRouter from './routes/pmsApiRoutes.js';
import workQueueRouter from '../routes/workQueue.js';
import { createCdcpRouter } from './routes/cdcp.js';
import { createCanadianExpansionRouter } from './routes/canadianExpansionApi.js';
import { stripeWebhookHandler, createStripeConnectRouter } from './routes/stripeApiRoutes';
import { createBillingRouter } from './routes/billingRoutes';
import { registerArJobSchedulers } from './jobs/registerSchedulers.js';
import { startLearningLoopInProcess } from './learning/scheduler.js';
import { startRulesEngine } from './rulesEngine.js';
import { isLearningLoopEnabled } from './learning/config.js';
import { makeSendgridEventWebhookHandler } from './sendgrid/handleSendgridEventWebhook.js';
import { handleTwilioInboundSms } from './twilio/inboundSms.js';
import { createFrontDeskRouter } from './routes/frontDeskApi.js';
import { createPracticeReportsRouter, createPortfolioRouter } from './routes/practiceReportsApi.js';
import { createPlatformPersonaAdminRouter } from './routes/platformPersonaAdminApi.js';
import { createEarlyAccessRouter } from './routes/earlyAccessRoutes.js';
import { createPartnershipsRouter } from './routes/partnershipsRouter.js';
import { createSendgridInboundRouter } from './routes/sendgridInboundRouter.js';
import { createDemoBookingWebhookRouter } from './routes/demoBookingWebhookRouter.js';
import { startMarketingLoopInProcess, startMarketingLearningInProcess } from './marketing/marketingScheduler.js';
import { attachDeskWebSocket } from './frontDesk/deskWs.js';
import { startDeskQueueEngine } from './frontDesk/queueEngine.js';
const app = express();
const PORT = parseInt(process.env.PORT ?? '3000', 10);

// Redirect bare domain to www so collectrx.ca/* → www.collectrx.ca/*
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.hostname === 'collectrx.ca') {
    return res.redirect(301, `https://www.collectrx.ca${req.url}`);
  }
  next();
});

// Behind Railway / other reverse proxies, trust X-Forwarded-* so req.ip and rate limits are per-client.
if (
  process.env.TRUST_PROXY === '1' ||
  process.env.TRUST_PROXY === 'true' ||
  process.env.NODE_ENV === 'production'
) {
  app.set('trust proxy', true);
}

app.use(
  helmet({
    hsts:
      process.env.NODE_ENV === 'production'
        ? { maxAge: 31536000, includeSubDomains: true, preload: false }
        : false,
    contentSecurityPolicy: false,
  }),
);

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

assertPostgresTlsInProduction();
assertPhiEncryptionAtRestConfigured();
assertEmrSyncWebhookUrlConfiguredAtBoot();

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

app.use(
  '/api/webhooks/sendgrid-inbound',
  webhookLimiter,
  createSendgridInboundRouter(prisma),
);

// ─────────────────────────────────────────────────────────────────────────────
// Standard middleware
// ─────────────────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.use(
  '/api/webhooks/demo-booking',
  webhookLimiter,
  createDemoBookingWebhookRouter(prisma),
);

// urlencoded is intentionally NOT global: only Twilio's signature-verified webhook posts
// form-encoded bodies. Keeping it off everywhere else shrinks the CSRF surface for the
// cookie-authenticated JSON API (browsers cannot send cross-site application/json without a
// CORS preflight, but they CAN send simple cross-site form posts).
app.post(
  '/api/twilio/sms',
  webhookLimiter,
  express.urlencoded({ extended: false }),
  (req, res, next) => {
    handleTwilioInboundSms(req, res, prisma).catch(next);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Health — excluded from /api rate limiting (tests + probes)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/health', healthLimiter, (_req: Request, res: Response) => {
  res.json({ status: 'ok', ts: new Date().toISOString(), service: 'collectrx-api' });
});

app.get('/api/health', healthLimiter, async (_req: Request, res: Response) => {
  const chOk = await pingClickHouse();
  res.json({
    status: 'ok',
    ts: new Date().toISOString(),
    service: 'collectrx-api',
    clickhouse: chOk ? 'connected' : isClickHouseMockMode() ? 'mock' : 'unavailable',
  });
});

app.get('/api/health/ready', healthLimiter, async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'not_ready' });
  }
});

app.get('/api/health/metrics', healthLimiter, (req: Request, res: Response) => {
  res.json(buildPublicHealthMetricsBody(req));
});

// Product telemetry ingestion — higher limit than standard /api (SDK batches every 5 s).
app.use('/api/telemetry/events', telemetryEventsLimiter);

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting — baseline for all /api/* routes.
// authLimiter (stricter) is applied inside authRoutes.ts on POST /login.
// ─────────────────────────────────────────────────────────────────────────────
app.use('/api', sessionStandardLimiter);
app.use('/api', anonStandardLimiter);

// ─────────────────────────────────────────────────────────────────────────────
// API routes
// ─────────────────────────────────────────────────────────────────────────────
app.use('/api/auth',       createAuthRouter(prisma));
app.use('/api/group',      createGroupAdminRouter(prisma));
app.use('/api/billing',    createBillingRouter(prisma));
app.use('/api/stripe',     createStripeConnectRouter(prisma));
app.use('/api/insurance',  insuranceRouter);
app.use('/api/calls',      createFrontDeskRouter());
app.use('/api/calls',      callsRouter);
app.use('/api/desk',       createFrontDeskRouter());
app.use('/api/practices',  createPracticeReportsRouter());
app.use('/api/reports',    createPortfolioRouter());
app.use('/api/carriers',   carriersRouter);
app.use('/api/analytics',  analyticsRouter);
app.use('/api/telemetry',   productTelemetryRouter);
app.use('/api/eligibility', eligibilityRouter);
app.use('/api/queue',       queueRouter);
app.use('/api',            createEarlyAccessRouter(prisma));
app.use('/api',            createPublicPatientPayRouter(prisma));
app.use('/api',            createBalancesOutreachRouter(prisma));
app.use('/api',            createBenefitsApiRouter(prisma));
app.use('/api',            createPatientArApiRouter(prisma));
app.use('/api/dashboard',  dashboardRouter);
app.use('/api/admin',      createPlatformPersonaAdminRouter());
app.use('/api/admin/partnerships', createPartnershipsRouter(prisma));
app.use('/api/admin',      adminRouter);
app.use('/api/admin/sync', pmsSyncRouter);
app.use('/api/pms', pmsApiRouter);
app.use('/api/work-queue', workQueueRouter);
// Phase 5: CDCP Reconsideration & High-Precision Adjudication
app.use('/api/cdcp',       createCdcpRouter(prisma));
app.use('/api',            createCanadianExpansionRouter(prisma));

// ─────────────────────────────────────────────────────────────────────────────
// Serve React frontend (SPA catch-all)
// Vite builds to dist/ at the package root. Any non-API request gets the React
// app so client-side routing works correctly in production.
// ─────────────────────────────────────────────────────────────────────────────
const distPath = new URL('../../dist', import.meta.url).pathname;
const indexHtmlPath = new URL('../../dist/index.html', import.meta.url).pathname;

if (process.env.NODE_ENV === 'production') {
  assertResourcePagesBuilt(distPath);
}

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

app.use(createResourceStaticMiddleware(distPath));
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
/** True when started via `tsx src/server/index.ts` / `npm run start` (argv may be relative). */
function isMainModule(): boolean {
  const self = fileURLToPath(import.meta.url);
  return process.argv.slice(1).some((arg) => {
    if (!arg || arg.startsWith('-')) return false;
    try {
      return path.resolve(arg) === self;
    } catch {
      return false;
    }
  });
}

async function connectDatabaseOrExit(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('[server] Database connected');
  } catch (err) {
    console.error('[server] Database connection failed:', err);
    process.exit(1);
  }
}

async function afterListen(server: ReturnType<typeof app.listen> | https.Server): Promise<void> {
  await connectDatabaseOrExit();

  try {
    const closed = await prisma.workItem.updateMany({
      where: { status: 'open', itemType: { not: 'insurance' } },
      data: { status: 'closed' },
    });
    if (closed.count > 0) {
      console.log(`[server] closed ${closed.count} legacy non-insurance work queue item(s)`);
    }
  } catch (err) {
    console.warn('[server] legacy work queue cleanup failed:', (err as Error).message);
  }

  void runTelemetryMigrations().catch((err) => {
    console.error('[Telemetry] ClickHouse migration failed (non-fatal):', err);
  });

  piiVault.purgeExpired();
  setInterval(() => {
    const purged = piiVault.purgeExpired();
    if (purged > 0) console.log(`[piiVault] Purged ${purged} expired tokens`);
  }, 60 * 60 * 1000);

  if (process.env.REDIS_URL) {
    registerArJobSchedulers().catch((err) => {
      console.error('[server] registerArJobSchedulers failed:', (err as Error).message);
    });
  } else {
    startRulesEngine(prisma);
    if (isLearningLoopEnabled()) {
      startLearningLoopInProcess(prisma);
    }
    startMarketingLoopInProcess(prisma);
    startMarketingLearningInProcess(prisma);
  }

  attachDeskWebSocket(server);
  startDeskQueueEngine(prisma);
  startOpsMonitor(prisma);
  void runStartupScanOnBoot(prisma, PORT);
}

async function boot() {
  const tlsKey = process.env.TLS_KEY_PATH?.trim();
  const tlsCert = process.env.TLS_CERT_PATH?.trim();
  const onListen = () => {
    const mode = tlsKey && tlsCert ? 'https' : 'http';
    console.log(`[server] CollectRx API listening on port ${PORT} (${mode})`);
    console.log('[server] Liveness: GET /api/health — readiness: GET /api/health/ready');
  };

  let server: ReturnType<typeof app.listen> | https.Server;
  try {
    if (tlsKey && tlsCert) {
      const opts = loadTlsCredentialsForNodeServer(tlsKey, tlsCert);
      server = https.createServer(opts, app).listen(PORT, onListen);
    } else {
      server = app.listen(PORT, onListen);
    }
  } catch (err) {
    console.error('[server] Failed to bind listen socket:', err);
    process.exit(1);
  }

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

  void afterListen(server).catch((err) => {
    console.error('[server] Post-listen startup failed:', err);
    process.exit(1);
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
