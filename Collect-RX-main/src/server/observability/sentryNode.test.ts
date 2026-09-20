/**
 * Ops hardening (PATH-TO-DELIVERY.md Group F, "Sentry DSNs + alerts"):
 * this module implemented server-side Sentry correctly (no-op without
 * SENTRY_DSN, proper Express integration, bounded flush on fatal errors) but
 * was never actually called from src/server/index.ts or workerEntry.ts —
 * only the frontend (src/main.tsx -> sentryClient.ts) was wired up. In
 * production, every backend crash, unhandled rejection, failed webhook, and
 * failed background job would have gone completely unreported even with a
 * real SENTRY_DSN configured.
 *
 * Two things are verified: the module's own behavior (functional), and that
 * the actual boot files call it (source-text check) — a source-text check
 * alone would only prove the declaration exists, not that anything uses it,
 * which is exactly the class of gap this ticket found.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as Sentry from '@sentry/node';
import { captureFatal, initSentry, installSentryExpressErrorHandler, isSentryEnabled } from './sentryNode.js';

const originalDsn = process.env.SENTRY_DSN;

describe('sentryNode — functional behavior', () => {
  it('stays disabled when SENTRY_DSN is unset', async () => {
    delete process.env.SENTRY_DSN;
    initSentry();
    expect(isSentryEnabled()).toBe(false);
    // Disabled captureFatal must resolve cleanly, not throw, so a real crash
    // handler calling it never gets stuck.
    await expect(captureFatal(new Error('probe'))).resolves.toBeUndefined();
  });

  it('becomes enabled once SENTRY_DSN is set and initSentry() runs', () => {
    process.env.SENTRY_DSN = 'https://public@o0.ingest.sentry.io/0';
    try {
      initSentry();
      expect(isSentryEnabled()).toBe(true);
      expect(Sentry.getClient()).toBeDefined();
    } finally {
      process.env.SENTRY_DSN = originalDsn;
    }
  });

  it('installSentryExpressErrorHandler does not throw once enabled', async () => {
    const express = (await import('express')).default;
    const app = express();
    expect(() => installSentryExpressErrorHandler(app)).not.toThrow();
  });
});

function readSource(...parts: string[]): string {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  return fs.readFileSync(path.join(dir, ...parts), 'utf8');
}

describe('sentryNode — actually wired into both Node entry points', () => {
  it('src/server/index.ts calls initSentry() and installSentryExpressErrorHandler()', () => {
    const source = readSource('..', 'index.ts');
    expect(source).toMatch(/\binitSentry\(\)/);
    expect(source).toMatch(/\binstallSentryExpressErrorHandler\(app\)/);
  });

  it('src/server/workerEntry.ts calls initSentry()', () => {
    const source = readSource('..', 'workerEntry.ts');
    expect(source).toMatch(/\binitSentry\(\)/);
  });
});
