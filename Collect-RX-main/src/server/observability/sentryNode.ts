import type { Express } from 'express';
import * as Sentry from '@sentry/node';

let enabled = false;

export function isSentryEnabled(): boolean {
  return enabled;
}

/**
 * P6-02: optional Sentry. Call once after `import 'dotenv/config'`, before other app setup.
 * Set SENTRY_DSN; use SENTRY_TRACES_SAMPLE_RATE (0–1), default 0.1 in prod, 0 in dev if unset.
 */
export function initSentry(): void {
  if (!process.env.SENTRY_DSN) {
    return;
  }
  const traces =
    process.env.SENTRY_TRACES_SAMPLE_RATE != null
      ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
      : process.env.NODE_ENV === 'production'
        ? 0.1
        : 0;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE || process.env.RAILWAY_GIT_COMMIT_SHA,
    tracesSampleRate: Math.min(1, Math.max(0, Number.isNaN(traces) ? 0 : traces)),
    integrations: [Sentry.expressIntegration()],
  });
  enabled = true;
}

/**
 * Call after all routes, before custom 404 / listen.
 */
export function installSentryExpressErrorHandler(app: Express): void {
  if (!enabled) {
    return;
  }
  Sentry.setupExpressErrorHandler(app);
}
