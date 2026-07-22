#!/usr/bin/env node
/**
 * Local dev prerequisites: ensure Redis is up when REDIS_URL is set.
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
