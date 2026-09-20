import { isIPv4 } from 'node:net';
import { logger } from './observability/logger.js';

/**
 * EMR sync outbox posts to `EMR_SYNC_WEBHOOK_URL` from the server (server-side request).
 * Validate URL shape and block obvious SSRF / internal metadata targets.
 */

/** Blocked in all environments (cloud metadata, link-local well-known). */
const METADATA_AND_LINK_HOSTS = new Set(
  [
    'metadata.google.internal',
    '169.254.169.254',
    'fd00:ec2::254',
  ].map((h) => h.toLowerCase()),
);

const LOOPBACK_HOSTS = new Set(
  ['localhost', '127.0.0.1', '0.0.0.0', '::1'].map((h) => h.toLowerCase()),
);

function ipv4IsPrivateOrLoopback(host: string): boolean {
  if (!isIPv4(host)) return false;
  const [a, b] = host.split('.').map((x) => parseInt(x, 10));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (host === '127.0.0.0' || a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  return false;
}

/**
 * @throws Error when URL is not acceptable for the current NODE_ENV.
 */
export function assertEmrSyncWebhookUrlAllowed(urlStr: string): void {
  const trimmed = urlStr.trim();
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    throw new Error('EMR_SYNC_WEBHOOK_URL is not a valid absolute URL');
  }
  if (u.username || u.password) {
    throw new Error('EMR_SYNC_WEBHOOK_URL must not embed credentials (use EMR_SYNC_WEBHOOK_SECRET header instead)');
  }
  const proto = u.protocol.toLowerCase();
  if (proto !== 'http:' && proto !== 'https:') {
    throw new Error('EMR_SYNC_WEBHOOK_URL must use http or https');
  }
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd && proto !== 'https:') {
    throw new Error('EMR_SYNC_WEBHOOK_URL must use https in production');
  }
  const host = u.hostname.toLowerCase();

  if (METADATA_AND_LINK_HOSTS.has(host)) {
    throw new Error('EMR_SYNC_WEBHOOK_URL hostname is not allowed');
  }

  if (isProd) {
    if (LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost')) {
      throw new Error('EMR_SYNC_WEBHOOK_URL must not target loopback in production');
    }
    if (ipv4IsPrivateOrLoopback(host)) {
      throw new Error('EMR_SYNC_WEBHOOK_URL must not target private or link-local IPv4 addresses in production');
    }
  }
}

/** Fail fast in production when EMR webhook is configured but invalid. */
export function assertEmrSyncWebhookUrlConfiguredAtBoot(): void {
  const url = (process.env.EMR_SYNC_WEBHOOK_URL || '').trim();
  if (!url) return;
  try {
    assertEmrSyncWebhookUrlAllowed(url);
  } catch (e) {
    const msg = (e as Error).message;
    if (process.env.NODE_ENV === 'production') {
      logger.error('[server] FATAL: invalid EMR_SYNC_WEBHOOK_URL —', { error: msg });
      process.exit(1);
    }
    logger.warn('[server] WARNING: EMR_SYNC_WEBHOOK_URL rejected —', { detail: msg });
  }
}
