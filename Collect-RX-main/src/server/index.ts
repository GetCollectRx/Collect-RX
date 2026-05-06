// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Express Backend Server
// Port: 3001 (Railway)
//
// Route map:
//   /api/auth/*            authRoutes.ts (login, logout, me)
//   /api/insurance/*       insurance.ts  (claims, queue)
//   /api/calls/*           calls.ts
//   /api/carriers/*        carriers.ts
//   /api/analytics/*       analytics.ts
//   /api/eligibility/*     eligibility.ts
//   /api/webhooks/vapi     webhooks/vapi.ts (raw body — mounted before json())
//
// Safety:
//   - Webhook route uses raw body parser (HMAC validation requires raw bytes)
//   - All other routes use express.json()
//   - Prisma client is singleton from lib/prisma.ts
//   - piiVault.purgeExpired() runs on boot and hourly
//   - Rate limiting: standardLimiter on all /api/*, webhookLimiter on Vapi,
//     authLimiter (5/15min) on POST /api/auth/login
//   - VAPI_WEBHOOK_SECRET required in production — server refuses to start without it
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';

import { prisma } from '../lib/prisma';
import { piiVault } from '../services/pii-vault';
import {
  standardLimiter,
  webhookLimiter,
} from './middleware/rateLimiter';

// Routes
import { createAuthRouter }  from './routes/authRoutes';
import insuranceRouter        from '../routes/insurance';
import callsRouter            from '../routes/calls';
import carriersRouter         from '../routes/carriers';
import analyticsRouter        from '../routes/analytics';
import eligibilityRouter      from '../routes/eligibility';
import vapiWebhookRouter      from '../webhooks/vapi';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);

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

// ─────────────────────────────────────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') ?? [
    'http://localhost:5173',  // Vite dev server
    'http://localhost:3000',
  ],
  credentials: true,
}));

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
// Standard middleware
// ─────────────────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting — baseline for all /api/* routes.
// authLimiter (stricter) is applied inside authRoutes.ts on POST /login.
// The /health endpoint is intentionally excluded (Railway health probes).
// ─────────────────────────────────────────────────────────────────────────────
app.use('/api', standardLimiter);

// ─────────────────────────────────────────────────────────────────────────────
// Health check — excluded from rate limiting
// ─────────────────────────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', ts: new Date().toISOString(), service: 'collectrx-api' });
});

// ─────────────────────────────────────────────────────────────────────────────
// API routes
// ─────────────────────────────────────────────────────────────────────────────
app.use('/api/auth',       createAuthRouter(prisma));
app.use('/api/insurance',  insuranceRouter);
app.use('/api/calls',      callsRouter);
app.use('/api/carriers',   carriersRouter);
app.use('/api/analytics',  analyticsRouter);
app.use('/api/eligibility', eligibilityRouter);

// ─────────────────────────────────────────────────────────────────────────────
// 404 handler
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
// Boot
// ─────────────────────────────────────────────────────────────────────────────
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

  app.listen(PORT, () => {
    console.log(`[server] CollectRx API listening on port ${PORT}`);
  });
}

boot().catch((err) => {
  console.error('[server] Fatal boot error:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[server] SIGTERM received — shutting down gracefully');
  await prisma.$disconnect();
  process.exit(0);
});

export default app;
