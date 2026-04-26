/**
 * P6-02: optional browser error reporting. Set VITE_SENTRY_DSN in the Vite build env.
 */
import * as Sentry from '@sentry/react';

export function initSentryClient(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) {
    return;
  }
  const traces = Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0);
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: Math.min(1, Math.max(0, Number.isNaN(traces) ? 0 : traces)),
  });
}

export { Sentry };
