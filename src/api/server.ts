import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { config } from './config';
import { seedDatabase } from './data/seed';
import { authRouter } from './routes/auth';
import { practicesRouter } from './routes/practices';
import { patientsRouter } from './routes/patients';
import { webhooksRouter } from './routes/webhooks';
import { scheduler } from './routes/patients';

const app = express();
app.set('trust proxy', 1);

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", ...config.allowedOrigins],
      },
    },
  })
);

// HTTPS redirect in production
if (config.nodeEnv === 'production') {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

app.use(cors({ origin: config.allowedOrigins, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '10kb' }));

// Global rate limit
app.use(
  '/api/',
  rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please slow down.' },
  })
);

// Audit logging
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/api/auth', authRouter);
app.use('/api/practices', practicesRouter);
app.use('/api/patients', patientsRouter);
app.use('/api/webhooks', webhooksRouter);

app.get('/health', (_req, res) => {
  const { db } = require('./db');
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    patients: db.patients.size,
    practices: db.practices.size,
  });
});

// Initialize data and start
seedDatabase();

const schedulerInterval = setInterval(async () => {
  try {
    await scheduler.processScheduledEmails();
  } catch (err: any) {
    console.error('❌ Scheduler error (will retry):', err.message);
  }
}, 5 * 60 * 1000);

const server = app.listen(config.port, () => {
  console.log(`\n🚀 CollectRx API running on port ${config.port}`);
  console.log(`   Environment: ${config.nodeEnv}`);
  console.log(`   SendGrid: ${config.sendgrid.mockMode ? 'mock' : 'live'}`);
  console.log(`   Stripe: ${config.stripe.mockMode ? 'mock' : 'live'}\n`);
});

function shutdown(signal: string) {
  console.log(`\n${signal} received — shutting down gracefully`);
  clearInterval(schedulerInterval);
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app };
