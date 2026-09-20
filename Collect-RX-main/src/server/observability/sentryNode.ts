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
    release: process.env.SENTRY_RELEASE,
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

/**
 * For uncaughtException/unhandledRejection only: the process exits right
 * after these fire, so the error must be flushed to Sentry's network client
 * before that happens, not just queued. Bounded to 2s so a Sentry outage
 * never delays the crash-and-restart the platform is waiting on.
 */
export async function captureFatal(err: unknown): Promise<void> {
  if (!enabled) return;
  Sentry.captureException(err);
  await Sentry.flush(2000).catch(() => undefined);
}
