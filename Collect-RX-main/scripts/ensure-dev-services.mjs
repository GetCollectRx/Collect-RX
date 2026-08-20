#!/usr/bin/env node
/**
 * Local dev prerequisites: ensure Redis is up when REDIS_URL is set, and that
 * DATABASE_URL actually points at something listening before the API/worker
 * spend a startup cycle crash-looping on a Prisma connection error.
 */
import { execSync } from 'node:child_process';
import net from 'node:net';
import { readEnvFromDotenv, repoRoot } from './free-dev-ports.mjs';

export function getRedisUrl() {
  return (readEnvFromDotenv('REDIS_URL') || process.env.REDIS_URL || '').trim();
}

function parseRedisEndpoint(url) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname || '127.0.0.1',
      port: parseInt(u.port || '6379', 10),
    };
  } catch {
    return null;
  }
}

function parsePostgresEndpoint(url) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname || '127.0.0.1',
      port: parseInt(u.port || '5432', 10),
    };
  } catch {
    return null;
  }
}

function isLoopbackHost(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

export function tcpReachable(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const finish = (ok) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.on('connect', () => finish(true));
    sock.on('error', () => finish(false));
    sock.on('timeout', () => finish(false));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * When REDIS_URL is set, verify Redis is reachable. For loopback URLs, try `docker compose up -d redis`.
 * @returns {{ enabled: boolean, url?: string }}
 */
export async function ensureLocalRedis() {
  const url = getRedisUrl();
  if (!url) {
    return { enabled: false };
  }

  const endpoint = parseRedisEndpoint(url);
  if (!endpoint) {
    console.warn('[dev] REDIS_URL is set but could not be parsed — jobs may fail');
    return { enabled: true, url };
  }

  const { host, port } = endpoint;
  if (await tcpReachable(host, port)) {
    return { enabled: true, url };
  }

  if (!isLoopbackHost(host)) {
    console.error(`[dev] REDIS_URL → ${host}:${port} is not reachable`);
    console.error('[dev] Fix remote Redis or unset REDIS_URL for in-process rules (no worker).');
    process.exit(1);
  }

  console.log('[dev] Redis not running — starting `docker compose up -d redis`…');
  try {
    execSync('docker compose up -d redis', { cwd: repoRoot, stdio: 'inherit' });
  } catch {
    console.error('[dev] Could not start Redis via Docker.');
    console.error('[dev]   • Install Docker Desktop, then: docker compose up -d redis');
    console.error('[dev]   • Or remove REDIS_URL from Collect-RX-main/.env (in-process rules, no worker)');
    process.exit(1);
  }

  for (let attempt = 1; attempt <= 20; attempt++) {
    await sleep(500);
    if (await tcpReachable(host, port)) {
      console.log('[dev] Redis ready');
      return { enabled: true, url };
    }
  }

  console.error('[dev] Redis did not become reachable after docker compose');
  process.exit(1);
}

/**
 * Verify DATABASE_URL is reachable before spawning the API/worker, which
 * would otherwise crash-loop on Prisma's generic connection-refused error.
 * The #1 cause locally is the Docker-vs-native Postgres port mismatch:
 * .env.example defaults to 5433 (docker compose up -d), but a native
 * apt/Homebrew/Postgres.app install defaults to 5432 with no error that
 * points at the port as the problem (OUTSTANDING-FIXES-PRODUCT-READY.md
 * P10-07). This only warns — DATABASE_URL is required, but a misconfigured
 * port shouldn't block dev.mjs from telling you why before something else
 * fails downstream with a worse message.
 */
export async function ensurePostgresReachable() {
  const url = (readEnvFromDotenv('DATABASE_URL') || process.env.DATABASE_URL || '').trim();
  if (!url) return; // .env.example marks this required; a missing var is a different problem.

  const endpoint = parsePostgresEndpoint(url);
  if (!endpoint) return; // malformed URL — let Prisma's own error surface it.

  const { host, port } = endpoint;
  if (await tcpReachable(host, port)) return;

  if (!isLoopbackHost(host)) {
    console.warn(`[dev] DATABASE_URL → ${host}:${port} is not reachable — API will fail to start.`);
    return;
  }

  if (port === 5433) {
    console.log(`[dev] Nothing listening on localhost:5433 (DATABASE_URL's port) — trying \`docker compose up -d postgres\`…`);
    try {
      execSync('docker compose up -d postgres', { cwd: repoRoot, stdio: 'inherit' });
      for (let attempt = 1; attempt <= 20; attempt++) {
        await sleep(500);
        if (await tcpReachable(host, port)) {
          console.log('[dev] Postgres ready');
          return;
        }
      }
    } catch {
      // fall through to the port-mismatch hint below
    }
    console.warn('[dev] Postgres is still not reachable on port 5433.');
    console.warn('[dev]   • Not using Docker? A native Postgres install defaults to port 5432 —');
    console.warn('[dev]     change DATABASE_URL in .env from :5433 to :5432 and try again.');
    console.warn('[dev]   • Using Docker? Install/start Docker Desktop, then: docker compose up -d postgres');
    return;
  }

  console.warn(`[dev] Nothing listening on localhost:${port} (DATABASE_URL's port) — is Postgres running?`);
  console.warn('[dev]   • Native install: `sudo pg_ctlcluster 16 main start` (Debian/Ubuntu) or `brew services start postgresql` (Mac)');
  console.warn('[dev]   • Meant to use Docker instead? `docker compose up -d postgres` publishes on port 5433 — update DATABASE_URL to match.');
}
