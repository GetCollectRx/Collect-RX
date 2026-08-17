// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Express Backend Server
// Port: 3000 (Fly.io)
//
// Route map:
//   /api/auth/*            authRoutes.ts (login, logout, me)
//   /api/insurance/*       insurance.ts  (claims, queue)
//   /api/calls/*           calls.ts
//   /api/carriers/*        carriers.ts
//   /api/analytics/*       analytics.ts (insurance KPIs)
//   /api/telemetry/*       productTelemetry.ts (ClickHouse usage SDK — optional)
//   /api/benefits/*        benefitsApi.ts (pre-treatment benefits + estimate)
//   /api/dashboard/*       dashboardRoutes.ts (ops stats)
//   /api/admin/*           adminRoutes.ts (settings, integrations, audit)
//   /api/eligibility/*     eligibility.ts
//   /api/cdcp/*            cdcp.ts (Phase 5: CDCP reconsideration, evidence gap, fee ceiling)
//   /api/queue/*           queue.ts (priority scores + carrier-order persistence)
//   /api/billing/*         billingRoutes.ts (practice subscription billing)
//   /api/webhooks/vapi     webhooks/vapi.ts (raw body — mounted before json())
//   /api/webhooks/sendgrid sendgrid/handleSendgridEventWebhook.ts (prospect engagement only)
//
// Removed (Practice→Insurance product — no patient billing / patient pay):
//   /api/patients/*        patientArApi.ts
//   /api/balances/*        balancesOutreachRoutes.ts
//   /api/public/*          publicPatientPayRoutes.ts
//   /api/twilio/sms        twilio/inboundSms.ts (patient pay replies)
//   /api/stripe/connect/*  stripeApiRoutes.ts (Connect onboarding — permanently retired)
//
// Safety:
//   - Webhook route uses raw body parser (HMAC validation requires raw bytes)
//   - All other routes use express.json()
//   - Prisma client is singleton from lib/prisma.ts
//   - claimsPiiVault.gc() runs on boot and hourly (main AES-256-GCM vault)
//   - Rate limiting: standardLimiter on all /api/*, webhookLimiter on webhooks,
//     healthLimiter on /health + /api/health/*, authLimiter (5/15min) on POST /api/auth/login
//     (when REDIS_URL is set, limiters use Redis so counts are shared across API replicas)
//   - trust proxy: enabled in production (or TRUST_PROXY=1) so req.ip + limits are client-accurate
//   - Insurance, calls, analytics, carriers, queue, eligibility: require practice JWT (cookie or Bearer)
//   - VAPI_WEBHOOK_SECRET required in production — server refuses to start without it
//   - SendGrid: SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY required in production (401 otherwise)
//   - Stripe Billing (practice SaaS subscription) via /api/billing + /api/webhooks/stripe
//   - PostgreSQL: in production DATABASE_URL must require TLS (sslmode=require or stricter); see databaseTls.ts
//   - Helmet (HSTS, etc.); CSP off for Vite SPA — tighten if you serve only JSON from this process
//   - Optional Node HTTPS: TLS_KEY_PATH + TLS_CERT_PATH → strict TLS 1.2+ (else HTTP behind proxy TLS)
//   - GET /api/health/metrics: deployment fingerprint redacted in production unless HEALTH_METRICS_TOKEN + Bearer header; also carries desk-queue (`queue`) and BullMQ/DLQ (`bullmq`) snapshots
//   - GET /api/health/live: event-loop lag liveness (503 "blocked" if the loop is stuck)
//   - GET /api/diagnostics: Vapi breaker + DB latency + desk queue + BullMQ/DLQ snapshot; requires HEALTH_METRICS_TOKEN bearer in production
//   - EMR_SYNC_WEBHOOK_URL validated at boot (prod) and each outbox batch — https + non-internal host in production
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';

import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { correlationIdMiddleware } from './middleware/correlationId.js';
import { logger } from './observability/logger.js';
import compression from 'compression';
import helmet from 'helmet';

import { resolveCorsAllowedOrigins } from './corsAllowedOrigins';
import { initSentry, installSentryExpressErrorHandler } from './observability/sentryNode.js';
import { checkRlsRoleSafety, getCachedRlsRoleSafety } from './observability/rlsRoleSafety.js';
import { prisma } from '../lib/prisma';
// Real PHI vault (full PatientPHI struct) — needs rehydrate on every boot.
// H-6: the legacy services/pii-vault.ts (simple string tokenizer, 24h TTL) is
// no longer imported here. The legacy tokenize/detokenize functions are orphaned
// since prismaClaimImporter.ts was migrated to the main vault. handlePostCallAudioDeletion
// and LLM_RESIDENCY_HEADERS from that file remain in use via their own direct imports
// in vapiWebhook.ts and agentRunner.ts — those are unaffected.
import { piiVault as claimsPiiVault } from '../pii-vault';
import { assertJwtConfigAtStartup } from './authToken';
import { assertPasswordResetEmailConfigAtStartup } from './email/passwordReset.js';
import { assertPostgresTlsInProduction } from './databaseTls';
import { assertRlsRoleSafeInProduction } from './db/rlsRoleGuard.js';
import {
  assertPersistentPhiVaultConfigured,
  assertPhiEncryptionAtRestConfigured,
} from './crypto/phiEncryptionKey.js';
import { assertEmrSyncWebhookUrlConfiguredAtBoot } from './emrWebhookUrl.js';
import { buildPublicHealthMetricsBody, hasValidHealthMetricsToken } from './healthMetricsExposure.js';
import { getEventLoopHealth } from './observability/eventLoopHealth.js';
import { startOpsMonitor } from './observability/opsMonitor.js';
import { runStartupScanOnBoot } from './observability/runStartupScan.js';
import { runWithRlsBypass } from './db/rlsContext.js';
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
import { createPublicUnsubscribeRouter } from './routes/publicUnsubscribeRoutes.js';
import { createOrgAdminRouter } from './routes/orgAdminRoutes';
import { createSsoRouter } from './routes/ssoRoutes';
import insuranceRouter        from '../routes/insurance';
import callsRouter            from '../routes/calls';
import carriersRouter         from '../routes/carriers';
import analyticsRouter        from '../routes/analytics';
import eligibilityRouter      from '../routes/eligibility';
import queueRouter              from '../routes/queue';
import vapiWebhookRouter      from '../webhooks/vapi';
import claimsValidatorRouter  from '../webhooks/claimsValidator';
import holdParkTestRouter     from '../webhooks/holdParkTest';
import { attachHoldParkAudioStream } from '../webhooks/holdParkAudioStream';
import { createBenefitsApiRouter } from './routes/benefitsApi';
import dashboardRouter from './routes/dashboardRoutes';
import adminRouter from './routes/adminRoutes';
import pmsSyncRouter from './routes/pmsSyncRoutes.js';
import pmsApiRouter from './routes/pmsApiRoutes.js';
import workQueueRouter from '../routes/workQueue.js';
import { createCdcpRouter } from './routes/cdcp.js';
import preVisitRouter from './routes/preVisitRoutes.js';
import { createCanadianExpansionRouter } from './routes/canadianExpansionApi.js';
import { stripeWebhookHandler } from './routes/stripeApiRoutes';
import { createBillingRouter } from './routes/billingRoutes';
import gocardlessRouter from './routes/gocardlessRoutes';
import { gocardlessWebhookHandler } from './webhooks/gocardless.js';
import { registerArJobSchedulers, registerAgentRunners } from './jobs/registerSchedulers.js';
import { startConnectorMonitorScheduler } from './jobs/connectorMonitorScheduler.js';
import { startPadReconciliationScheduler } from './jobs/padReconciliationScheduler.js';
import { startScheduledAgents } from './agents/scheduledAgents.js';
import { startLearningLoopInProcess } from './learning/scheduler.js';
import { startRulesEngine } from './rulesEngine.js';
import { isLearningLoopEnabled } from './learning/config.js';
import { drainGuardrailAuditOutbox } from '../workers/guardrailAuditWorker.js';
import { makeSendgridEventWebhookHandler } from './sendgrid/handleSendgridEventWebhook.js';

import { createFrontDeskRouter } from './routes/frontDeskApi.js';
import { createPracticeReportsRouter, createPortfolioRouter } from './routes/practiceReportsApi.js';
import { createPlatformPersonaAdminRouter } from './routes/platformPersonaAdminApi.js';
import { createEarlyAccessRouter } from './routes/earlyAccessRoutes.js';
import { createDesktopReleasesRouter } from './routes/desktopReleasesRoutes.js';
import { createConnectorRouter } from './routes/connectorRoutes.js';
import { createConnectorAdminRouter } from './routes/connectorAdminRoutes.js';
import { createPartnershipsRouter } from './routes/partnershipsRouter.js';
import { createDlqAdminRouter } from './routes/dlqAdminRoutes.js';
import { createSendgridInboundRouter } from './routes/sendgridInboundRouter.js';
import { createDemoBookingWebhookRouter } from './routes/demoBookingWebhookRouter.js';
import { startMarketingLoopInProcess, startMarketingLearningInProcess } from './marketing/marketingScheduler.js';
import { startEmailCampaignScheduler } from './marketing/emailCampaignScheduler.js';
import { attachDeskWebSocket, closeAllDeskConnections } from './frontDesk/deskWs.js';
import { startDeskQueueEngine, drainDeskQueueEngine } from './frontDesk/queueEngine.js';
import { complianceRouter } from './routes/complianceRoutes.js';
import { complianceWorkspaceRouter } from './routes/complianceWorkspaceRoutes.js';
import { createCarrierDiscoveryRouter } from './routes/carrierDiscoveryRoutes.js';
import { createTriageCredentialRouter } from './routes/triageCredentialRoutes.js';
import { registerEmailCampaignRoutes } from './routes/emailCampaignRoutes.js';
import { registerCampaignRoutes } from './routes/campaignRoutes.js';

// P6-02: optional Sentry — no-ops when SENTRY_DSN is unset. Must run before
// other app setup so it can wrap what follows.
initSentry();

const app = express();
app.use(compression());
const PORT = parseInt(process.env.PORT ?? '3000', 10);

// Without these, an uncaught error anywhere (e.g. a background async path) kills the
// process silently — the platform then just sees the healthcheck fail with no indication why.
// Per Node's own guidance, the process is in an unknown state after either event, so we
// log full detail for visibility in fly logs and then exit so the platform restarts
// the container cleanly, instead of leaving a half-broken process running.
// Playwright sets COLLECTRX_E2E=1: log but do not exit — a single background rejection
// must not take down the suite mid-run (remaining tests would see ERR_CONNECTION_REFUSED).
const e2eMode = (() => {
  const v = (process.env.COLLECTRX_E2E || '').trim();
  return v === '1' || v.toLowerCase() === 'true';
})();
process.on('uncaughtException', (err) => {
  logger.error('[server] FATAL: uncaughtException', { error: err });
  if (!e2eMode) process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error('[server] FATAL: unhandledRejection', { error: reason });
  if (!e2eMode) process.exit(1);
});

// Redirect bare domain to www so collectrx.ca/* → www.collectrx.ca/*
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.hostname === 'collectrx.ca') {
    return res.redirect(301, `https://www.collectrx.ca${req.url}`);
  }
  next();
});

// Behind Fly / other reverse proxies, trust X-Forwarded-* so req.ip and rate limits are per-client.
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
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// VAPI_WEBHOOK_SECRET guard
// In production, refuse to start without the secret — a missing secret means
// anyone can POST forged Vapi events to the server.
// ─────────────────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production' && !process.env.VAPI_WEBHOOK_SECRET) {
  logger.error('[server] FATAL: VAPI_WEBHOOK_SECRET is not set in production', {
    hint: 'Set this env var (fly secrets set) to enable webhook signature verification. Refusing to start.',
  });
  process.exit(1);
}
if (!process.env.VAPI_WEBHOOK_SECRET) {
  logger.warn('[server] VAPI_WEBHOOK_SECRET is not set', {
    hint: 'Webhook signature verification is DISABLED. Set this in production.',
  });
}

try {
  assertJwtConfigAtStartup();
  assertPasswordResetEmailConfigAtStartup();
} catch (e) {
  logger.error('[server] FATAL', { error: e });
  process.exit(1);
}

assertPostgresTlsInProduction();
assertPhiEncryptionAtRestConfigured();
assertPersistentPhiVaultConfigured();
assertEmrSyncWebhookUrlConfiguredAtBoot();

// ─────────────────────────────────────────────────────────────────────────────
// CORS — see corsAllowedOrigins.ts (collectrx.ca apex ↔ www mirrored when one is set)
// ─────────────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: resolveCorsAllowedOrigins(),
  credentials: true,
}));

// ─────────────────────────────────────────────────────────────────────────────
// Stripe — webhook requires raw body (practice SaaS Billing)
// ─────────────────────────────────────────────────────────────────────────────
app.post(
  '/api/stripe/webhook',
  webhookLimiter,
  express.raw({ type: 'application/json' }),
  stripeWebhookHandler(prisma),
);

// ─────────────────────────────────────────────────────────────────────────────
// GoCardless PAD — real-time webhook (HMAC-verified, see webhooks/gocardless.ts).
// The reconciliation poller (POST /api/gocardless/reconcile, or the cron job in
// jobs/padReconciliationScheduler.ts) is a safety net for missed deliveries.
// ─────────────────────────────────────────────────────────────────────────────
app.post(
  '/api/webhooks/gocardless',
  webhookLimiter,
  express.raw({ type: 'application/json' }),
  gocardlessWebhookHandler(prisma),
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

// ─────────────────────────────────────────────────────────────────────────────
// Claims Validator webhook — async validation after call ends
// Runs OFF-CALL after Claims_Agent completes; validates extraction & safety
// ─────────────────────────────────────────────────────────────────────────────
app.use(
  '/api/webhooks/claims/validate',
  webhookLimiter,
  express.json({ limit: '10mb' }),
  claimsValidatorRouter,
);

// ─────────────────────────────────────────────────────────────────────────────
// Hold-Park billing test, temporary, engineering test only (see
// src/webhooks/holdParkTest.ts). This URL is also this Vapi phone number's
// server.url, so it receives Vapi's own JSON server-events in addition to
// Twilio's application/x-www-form-urlencoded voice webhook; both parsers are
// needed, each only acts on its own content-type and leaves the other alone.
// ─────────────────────────────────────────────────────────────────────────────
app.use(
  '/api/webhooks/hold-park',
  webhookLimiter,
  express.json(),
  express.urlencoded({ extended: false }),
  holdParkTestRouter,
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
app.use(correlationIdMiddleware);

app.use(
  '/api/webhooks/demo-booking',
  webhookLimiter,
  createDemoBookingWebhookRouter(prisma),
);


// ─────────────────────────────────────────────────────────────────────────────
// Health — excluded from /api rate limiting (tests + probes)
// ─────────────────────────────────────────────────────────────────────────────
// Flipped the instant graceful shutdown begins (see registerGracefulShutdown
// below) so Fly stops routing new traffic here before the drain completes,
// rather than discovering the instance is going away only when a request
// already in flight fails.
let shuttingDown = false;

/**
 * Test-only seam: registerGracefulShutdown() only runs from boot(), which is
 * gated behind isMainModule() and never executes when this file is imported
 * under vitest — so integration tests need a way to exercise the
 * /api/health/ready shutdown branch without invoking real signal handlers
 * (which call process.exit() and would kill the test worker).
 */
export function __setShuttingDownForTests(value: boolean): void {
  shuttingDown = value;
}

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
  if (shuttingDown) {
    res.status(503).json({ status: 'not_ready', reason: 'shutting_down' });
    return;
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    res.status(503).json({ status: 'not_ready' });
    return;
  }
  // See docs/operations/HUMAN-DECISIONS-PENDING.md #3 — a superuser/BYPASSRLS
  // DB role makes tenant-isolation RLS a silent no-op. Only enforced where the
  // boot-time check actually ran (production); staging/local dev report ready
  // regardless, since developers routinely connect as a local superuser.
  if (process.env.NODE_ENV === 'production') {
    const rls = getCachedRlsRoleSafety();
    if (rls.checked && !rls.safe) {
      res.status(503).json({
        status: 'not_ready',
        error: 'Postgres role fails RLS safety check (superuser or BYPASSRLS) — tenant isolation is a no-op',
      });
      return;
    }
  }
  res.json({ status: 'ready' });
});

app.get('/api/health/metrics', healthLimiter, async (req: Request, res: Response) => {
  const body = buildPublicHealthMetricsBody(req);

  const queue = await (async () => {
    try {
      const { getQueueHealth } = await import('./observability/queueHealth.js');
      return await getQueueHealth(prisma);
    } catch (err) {
      logger.error('[health/metrics] queue health unavailable', { error: err });
      return { error: 'unavailable' };
    }
  })();

  // P1.3 — BullMQ job counts + DLQ backlog, isolated from the desk-queue
  // check above: a Redis outage must not blank out the (unrelated) desk
  // queue signal, and vice versa.
  const bullmq = await (async () => {
    try {
      const { getBullMqDiagnostics } = await import('./observability/diagnostics.js');
      return await getBullMqDiagnostics(prisma);
    } catch (err) {
      logger.error('[health/metrics] bullmq diagnostics unavailable', { error: err });
      return { configured: true, error: 'unavailable' };
    }
  })();

  res.json({ ...body, queue, bullmq });
});

// P1.2 — liveness beyond "process is up": event-loop lag sampled continuously
// in the background (eventLoopHealth.ts), read here rather than measured
// inline (measuring inline would just add the lag it's observing to the
// response). /api/health/ready only proves the DB is reachable; this proves
// the process can actually service a request promptly.
app.get('/api/health/live', healthLimiter, (_req: Request, res: Response) => {
  const eventLoop = getEventLoopHealth();
  res.status(eventLoop.blocked ? 503 : 200).json({
    status: eventLoop.blocked ? 'blocked' : 'alive',
    uptimeSec: Math.floor(process.uptime()),
    eventLoopDelayMs: { mean: eventLoop.meanMs, p99: eventLoop.p99Ms, max: eventLoop.maxMs },
  });
});

// P1.2 — one-stop incident-response snapshot: Vapi circuit breaker, DB
// latency, desk-queue tick health, BullMQ depths + DLQ backlog, event-loop
// lag. Gated more strictly than /api/health/metrics (which is public and
// only redacts one field) because this exposes materially more operational
// detail — in production it is unreachable at all without a valid
// HEALTH_METRICS_TOKEN bearer, even if the token itself was never configured.
app.get('/api/diagnostics', healthLimiter, async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production' && !hasValidHealthMetricsToken(req)) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }
  try {
    const { buildDiagnosticsSnapshot } = await import('./observability/diagnostics.js');
    const snapshot = await buildDiagnosticsSnapshot(prisma);
    res.json({ success: true, ...snapshot });
  } catch (err) {
    logger.error('[diagnostics] snapshot failed', { error: err });
    res.status(500).json({ success: false, error: 'diagnostics unavailable' });
  }
});

// Public download metadata — must not sit behind session auth (download page is unauthenticated).
app.use('/api', createDesktopReleasesRouter());

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
app.use('/api/auth/sso',   createSsoRouter(prisma));
app.use('/api/group',      createGroupAdminRouter(prisma));
// Mounted at /api/admin/organizations, not /api/admin — this router's own
// authenticate/authorizeRole('platform_dev') gate is a router-wide `.use()`,
// which Express applies to every request whose path starts with the mount
// prefix regardless of whether one of this router's own routes matches.
// Mounted at the bare /api/admin prefix (matching adminRouter below), it
// intercepted and 403'd every /api/admin/* request for any non-platform_dev
// session before adminRouter ever got a chance to handle it — reproduced
// live via supertest: GET /api/admin/practice-identity 403'd for a real
// practice_owner session with "Insufficient permissions for this action",
// authorizeRole's exact error string, not adminRoutes.ts's own. Internal
// route paths in orgAdminRoutes.ts already start with /organizations, so
// this mount change alone keeps every external URL
// (POST /api/admin/organizations, etc.) identical — see the route-path fix
// alongside this one.
app.use('/api/admin/organizations', createOrgAdminRouter(prisma));
app.use('/api/public', createPublicUnsubscribeRouter(prisma));
app.use('/api/billing',    createBillingRouter(prisma));
app.use('/api/gocardless', gocardlessRouter);
app.use('/api/insurance',  insuranceRouter);
app.use('/api/calls',      createFrontDeskRouter());
app.use('/api/calls',      callsRouter);
app.use('/api/desk',       createFrontDeskRouter());
app.use('/api/practices',  createPracticeReportsRouter());
app.use('/api/practices',  createTriageCredentialRouter());
app.use('/api/reports',    createPortfolioRouter());
app.use('/api/carriers',   carriersRouter);
app.use('/api/analytics',  analyticsRouter);
app.use('/api/telemetry',   productTelemetryRouter);
app.use('/api/eligibility', eligibilityRouter);
app.use('/api/queue',       queueRouter);
app.use('/api',            createEarlyAccessRouter(prisma));
app.use('/api/connector',  createConnectorRouter());
app.use('/api/admin/connector', createConnectorAdminRouter());
app.use('/api/admin/dlq', createDlqAdminRouter());
app.use('/api',            createBenefitsApiRouter(prisma));
app.use('/api/dashboard',  dashboardRouter);
app.use('/api/admin',      createPlatformPersonaAdminRouter());
app.use('/api/admin/partnerships', createPartnershipsRouter(prisma));
registerEmailCampaignRoutes(app, prisma);
registerCampaignRoutes(app, prisma);
app.use('/api/admin',      adminRouter);
app.use('/api/admin/sync', pmsSyncRouter);
app.use('/api/pms', pmsApiRouter);
app.use('/api/work-queue', workQueueRouter);
// Phase 5: CDCP Reconsideration & High-Precision Adjudication
app.use('/api/cdcp',       createCdcpRouter(prisma));
app.use('/api/pre-visit',  preVisitRouter);
app.use('/api',            createCanadianExpansionRouter(prisma));
// Compliance audit — platform_admin / auditor only
app.use('/api/compliance', complianceRouter);
app.use('/api/compliance/workspace', complianceWorkspaceRouter);
// Operator-only discovery records; no scheduler or dispatch worker is mounted.
app.use('/api/admin/carrier-discovery', createCarrierDiscoveryRouter());

// Autonomous agent runtime — structured outputs + escalation
import agentRunsRouter from './routes/agentRunsRouter.js';
app.use('/api/agent-runs', agentRunsRouter);

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
app.use(
  express.static(distPath, {
    setHeaders(res, filePath) {
      // Vite emits content-hashed asset filenames, so a new build changes the
      // URL — those can be cached indefinitely. index.html (served by the SPA
      // catch-all below, not here) must never be long-cached or new deploys
      // wouldn't be picked up.
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }),
);
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

// Must run after all routes/the 404 fallback, before the app's own error
// handler below — Sentry.setupExpressErrorHandler re-throws to the next
// error middleware after capturing, it doesn't send a response itself.
installSentryExpressErrorHandler(app);

// ─────────────────────────────────────────────────────────────────────────────
// Global error handler
// ─────────────────────────────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('[server] Unhandled error', { error: err });
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

async function connectDatabase(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info('[server] Database connected', {});
  } catch (err) {
    logger.error('[server] Database connection failed', { error: err });
    throw err;
  }
}

const GRACEFUL_SHUTDOWN_JOB_TIMEOUT_MS = Math.max(
  1_000,
  Number(process.env.GRACEFUL_SHUTDOWN_JOB_TIMEOUT_MS || 30_000),
);
const GRACEFUL_SHUTDOWN_TOTAL_TIMEOUT_MS = Math.max(
  GRACEFUL_SHUTDOWN_JOB_TIMEOUT_MS,
  Number(process.env.GRACEFUL_SHUTDOWN_TOTAL_TIMEOUT_MS || 60_000),
);

let shutdownStarted = false;

export interface GracefulShutdownResult {
  timedOut: boolean;
}

/**
 * Maps the shutdown sequence's outcome to a process exit code. Pulled out as
 * a pure function so the force-exit-on-timeout behavior is unit-testable
 * without any test ever having to call the real process.exit().
 */
export function exitCodeForShutdownResult(result: GracefulShutdownResult): number {
  return result.timedOut ? 1 : 0;
}

/**
 * The actual phased shutdown: close in dependency order — WS clients, the
 * desk queue tick (so an in-flight claim dispatch isn't abandoned mid-call),
 * the HTTP server (drains in-flight requests rather than dropping them),
 * then Prisma. Bounded by totalTimeoutMs via Promise.race so a hung close()
 * can't leave shutdown running forever; the caller decides what "timed out"
 * means for the process (see exitCodeForShutdownResult).
 *
 * Deliberately free of process.exit() / process.on() so it can be exercised
 * directly in tests — registerGracefulShutdown() below is the only place
 * that wires it to real OS signals and calls process.exit().
 *
 * Every log line here carries the same correlationId so a shutdown can be
 * traced end to end in aggregated logs even though it spans multiple
 * modules (deskWs, queueEngine, this file).
 */
export async function runGracefulShutdownSequence(
  server: ReturnType<typeof app.listen> | https.Server,
  opts: { jobTimeoutMs: number; totalTimeoutMs: number; correlationId: string; signal: string },
): Promise<GracefulShutdownResult> {
  const { jobTimeoutMs, totalTimeoutMs, correlationId, signal } = opts;
  logger.info('[server] shutdown signal received — starting graceful shutdown', { signal, correlationId });

  const work = (async () => {
    try {
      closeAllDeskConnections();
    } catch (err) {
      logger.error('[server] error closing desk WebSocket connections', { error: err, correlationId });
    }

    try {
      await drainDeskQueueEngine(jobTimeoutMs);
    } catch (err) {
      logger.error('[server] error draining desk queue engine', { error: err, correlationId });
    }

    await new Promise<void>((resolve) => {
      server.close((err) => {
        if (err) logger.error('[server] error closing HTTP server', { error: err, correlationId });
        resolve();
      });
    });

    try {
      await prisma.$disconnect();
    } catch (err) {
      logger.error('[server] error disconnecting Prisma during shutdown', { error: err, correlationId });
    }
  })();

  let timedOut = false;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      resolve();
    }, totalTimeoutMs);
    timeoutTimer.unref?.();
  });

  await Promise.race([work, timeout]);
  clearTimeout(timeoutTimer);

  if (timedOut) {
    logger.error('[server] graceful shutdown exceeded timeout — forcing exit', { totalTimeoutMs, correlationId });
  } else {
    logger.info('[server] graceful shutdown complete', { correlationId });
  }

  return { timedOut };
}

function registerGracefulShutdown(server: ReturnType<typeof app.listen> | https.Server): void {
  const shutdown = (signal: string) => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    shuttingDown = true;
    const correlationId = randomUUID();

    void runGracefulShutdownSequence(server, {
      jobTimeoutMs: GRACEFUL_SHUTDOWN_JOB_TIMEOUT_MS,
      totalTimeoutMs: GRACEFUL_SHUTDOWN_TOTAL_TIMEOUT_MS,
      correlationId,
      signal,
    }).then((result) => {
      process.exit(exitCodeForShutdownResult(result));
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

async function afterListen(server: ReturnType<typeof app.listen> | https.Server): Promise<void> {
  registerGracefulShutdown(server);

  try {
    const closed = await prisma.workItem.updateMany({
      where: { status: 'open', itemType: { not: 'insurance' } },
      data: { status: 'closed' },
    });
    if (closed.count > 0) {
      logger.info('[server] closed legacy non-insurance work queue items', { closed: closed.count });
    }
  } catch (err) {
    logger.warn('[server] legacy work queue cleanup failed', { error: err });
  }

  void runTelemetryMigrations().catch((err) => {
    logger.error('[Telemetry] ClickHouse migration failed (non-fatal)', { error: err });
  });

  // Periodic GC on main vault (AES-256-GCM, claim-lifecycle TTL via PHI_VAULT_TTL_DAYS — holds full PatientPHI for call dispatch).
  // H-6: legacy vault (services/pii-vault.ts, 24h TTL, simple string tokens) GC removed —
  // the legacy tokenize/detokenize functions are no longer called and the legacy vault
  // accumulates no new entries, so purging it is a no-op and creates misleading log output.
  claimsPiiVault.gc();
  setInterval(() => {
    const purgedMain = claimsPiiVault.gc();
    if (purgedMain > 0) logger.info('[piiVault] GC purged PHI tokens', { purged: purgedMain });
  }, 60 * 60 * 1000);

  if (process.env.REDIS_URL) {
    registerArJobSchedulers().catch((err) => {
      logger.error('[server] registerArJobSchedulers failed', { error: err });
    });
    registerAgentRunners().catch((err) => {
      logger.error('[server] registerAgentRunners failed', { error: err });
    });
  } else {
    startRulesEngine(prisma);
    if (isLearningLoopEnabled()) {
      startLearningLoopInProcess(prisma);
    }
    startMarketingLoopInProcess(prisma);
    startMarketingLearningInProcess(prisma);
    startEmailCampaignScheduler(prisma);
  }

  startConnectorMonitorScheduler(prisma);
  startPadReconciliationScheduler(prisma);

  attachDeskWebSocket(server);
  attachHoldParkAudioStream(server);

  startDeskQueueEngine(prisma);
  startOpsMonitor(prisma);
  void runStartupScanOnBoot(prisma, PORT);

  // ── Autonomous agent system ──────────────────────────────────────────────────
  // 23 cron-based agents + 6 event-triggered agents.
  // Activate by setting AGENTS_ENABLED=true in the host env vars.
  // Also requires GEMINI_API_KEY (already used by learning + marketing modules)
  // and AGENTS_DIR pointing to the agents/ folder (defaults to ../../agents).
  startScheduledAgents(prisma);
}

async function initializePersistentPhiVault(): Promise<void> {
  await connectDatabase();
  await assertRlsRoleSafeInProduction(prisma);
  claimsPiiVault.useStore(prisma);
  const rehydrated = await runWithRlsBypass(async () => claimsPiiVault.rehydrate());
  logger.info('[piiVault] Rehydrated PHI tokens from encrypted store', { rehydrated });
}

async function boot() {
  // Bind the port before any DB/PHI-vault work. Fly's proxy checks for an open
  // listening socket on machine start, separately from and before it starts
  // polling the HTTP health check — if DB connect + PHI rehydration (which can
  // take several seconds) runs before .listen(), that window shows up as
  // "app is not listening on the expected address" on every restart. /api/health
  // (fly.toml's check) doesn't touch the DB, so it's safe to serve immediately;
  // /api/health/ready does check the DB and gates whether Fly should route real
  // traffic here — see fly.toml, which points the actual health check at it.
  const tlsKey = process.env.TLS_KEY_PATH?.trim();
  const tlsCert = process.env.TLS_CERT_PATH?.trim();
  const onListen = () => {
    const mode = tlsKey && tlsCert ? 'https' : 'http';
    logger.info('[server] CollectRx API listening', { port: PORT, mode });
    logger.info('[server] Liveness: GET /api/health — readiness: GET /api/health/ready', {});
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
    logger.error('[server] Failed to bind listen socket', { error: err });
    process.exit(1);
  }

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error('[server] Port already in use', {
        port: PORT,
        hint: `Stop the other process: lsof -nP -iTCP:${PORT} -sTCP:LISTEN, or set PORT (and API_PORT for Vite proxy) in Collect-RX-main/.env`,
      });
      process.exit(1);
    }
    throw err;
  });

  // Start guardrail audit worker (non-blocking, runs every 60s)
  if (process.env.SIDECAR_URL) {
    setInterval(drainGuardrailAuditOutbox, 60_000);
    logger.info('[server] Guardrail audit worker started', {});
  } else if (process.env.NODE_ENV === 'production') {
    // Guardrail audit is a post-call compliance control (PHI-leak / hallucination /
    // off-script / carrier-block detection that can auto-apply CARRIER_BLOCK). With no
    // SIDECAR_URL the outbox is never drained, so calls still enqueue but go unaudited
    // and the outbox grows unbounded. Fail loud so error alerting catches it rather than
    // letting a compliance control silently degrade in production.
    logger.error('[server] CRITICAL: SIDECAR_URL not set in production — guardrail audit is DISABLED', {
      hint:
        'Post-call PHI-leak/hallucination/carrier-block auditing is NOT running and the audit ' +
        'outbox will accumulate unprocessed rows. Set SIDECAR_URL (fly secrets set) to restore it.',
    });
  } else {
    logger.warn('[server] SIDECAR_URL not set — guardrail audits disabled (dev)', {});
  }

  try {
    await initializePersistentPhiVault();
  } catch (err) {
    logger.error('[server] PHI vault initialization failed; refusing to start', { error: err });
    process.exit(1);
  }

  // docs/operations/HUMAN-DECISIONS-PENDING.md #3: a superuser/BYPASSRLS
  // connection makes every RLS tenant-isolation policy a silent no-op. Cache
  // the role's actual attributes so /api/health/ready can fail loudly instead
  // — checked in every NODE_ENV (Fly sets NODE_ENV=production on both staging
  // and prod) so this fires before real traffic ever gets routed here, but
  // never blocks boot itself: a slow/flaky check here shouldn't turn into an
  // outage on top of whatever it's trying to catch.
  if (process.env.NODE_ENV === 'production') {
    void checkRlsRoleSafety(prisma);
  }

  void afterListen(server).catch((err) => {
    logger.error('[server] Post-listen startup failed', { error: err });
    process.exit(1);
  });
}

if (isMainModule()) {
  boot().catch((err) => {
    logger.error('[server] Fatal boot error', { error: err });
    process.exit(1);
  });
  // SIGTERM/SIGINT are handled by registerGracefulShutdown(), wired up from
  // afterListen() once the HTTP server exists.
}

export { app, prisma };
export default app;
