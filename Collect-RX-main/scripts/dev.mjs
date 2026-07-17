#!/usr/bin/env node
/**
 * Dev orchestrator:
 * - DEV_API_TARGET=local (default): free ports, local Express + Vite (aligned proxy).
 * - DEV_API_TARGET=remote: Vite only; /api proxied to production (collectrx.ca / Railway).
 */
import { spawn } from 'node:child_process';
import {
  freeCollectRxDevPorts,
  pickFreePort,
  pkgRoot,
  readEnvFromDotenv,
  readPortFromEnvFile,
} from './free-dev-ports.mjs';
import { ensureLocalRedis } from './ensure-dev-services.mjs';

const COLLECTRX_DEFAULT_REMOTE_API = 'https://collect-rx.fly.dev';

function normalizeOrigin(raw) {
  const t = String(raw || '').trim().replace(/\/$/, '');
  if (!t || !/^https?:\/\//i.test(t)) return '';
  return t;
}

/** Production API for collectrx.ca (static site has no JSON /api). */
function resolveRemoteApiOrigin() {
  const candidates = [
    readEnvFromDotenv('DEV_API_ORIGIN'),
    readEnvFromDotenv('VITE_API_PROXY_TARGET'),
    readEnvFromDotenv('VITE_API_ORIGIN'),
    readEnvFromDotenv('PUBLIC_API_BASE_URL'),
  ]
    .map(normalizeOrigin)
    .filter(Boolean);

  for (const origin of candidates) {
    try {
      const host = new URL(origin).hostname;
      if (host === 'localhost' || host === '127.0.0.1') continue;
      return origin;
    } catch {
      continue;
    }
  }
  return COLLECTRX_DEFAULT_REMOTE_API;
}

function devApiTarget() {
  const raw = (
    readEnvFromDotenv('DEV_API_TARGET') ||
    readEnvFromDotenv('DEV_CONNECT_TO') ||
    'local'
  ).toLowerCase();
  if (['remote', 'production', 'prod', 'collectrx', 'collectrx.ca', 'hosted'].includes(raw)) {
    return 'remote';
  }
  return 'local';
}

const preferredVite = readPortFromEnvFile('VITE_PORT', 5173);

async function main() {
  const mode = devApiTarget();

  if (mode === 'remote') {
  freeCollectRxDevPorts({ apiPort: readPortFromEnvFile('PORT', 3000), vitePort: preferredVite });
  const vitePort = pickFreePort(preferredVite);
  const remoteApi = resolveRemoteApiOrigin();
  const publicSite =
    normalizeOrigin(readEnvFromDotenv('PUBLIC_APP_URL')) || 'https://www.collectrx.ca';

  console.log('');
  console.log('[dev] ─────────────────────────────────────────');
  console.log('[dev] Mode: production API (Fly — collect-rx.fly.dev)');
  console.log(`[dev] App (local UI):         http://localhost:${vitePort}/`);
  console.log(`[dev] Public site (patients): ${publicSite}`);
  console.log(`[dev] Vite /api proxy →         ${remoteApi}`);
  console.log('[dev] (local Express is not started in remote mode)');
  console.log('[dev] ─────────────────────────────────────────');
  console.log('');

  const env = {
    ...process.env,
    VITE_API_PROXY_TARGET: remoteApi,
    VITE_DEV_SERVER_PORT: String(vitePort),
  };

  const child = spawn('npm', ['run', 'dev:frontend'], {
    cwd: pkgRoot,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  } else {
  const preferredApi = readPortFromEnvFile('PORT', 3000);
  freeCollectRxDevPorts({ apiPort: preferredApi, vitePort: preferredVite });

  const redis = await ensureLocalRedis();
  const useWorker = redis.enabled;

  const apiPort = pickFreePort(preferredApi);
  const vitePort = pickFreePort(preferredVite);
  const workerHealthPort = readEnvFromDotenv('WORKER_HEALTH_PORT')
    ? readPortFromEnvFile('WORKER_HEALTH_PORT', apiPort + 1)
    : apiPort + 1;

  if (apiPort !== preferredApi) {
    console.warn(
      `[dev] Port ${preferredApi} is in use by another app — API will use ${apiPort} (Vite proxy aligned via API_PORT)`,
    );
  }
  if (vitePort !== preferredVite) {
    console.warn(`[dev] Port ${preferredVite} is in use — Vite will use ${vitePort}`);
  }

  console.log('');
  console.log('[dev] ─────────────────────────────────────────');
  console.log('[dev] Mode: local API + UI');
  console.log(`[dev] App (open in browser):  http://localhost:${vitePort}/`);
  console.log(`[dev] API (Express):          http://127.0.0.1:${apiPort}`);
  console.log(`[dev] Vite /api proxy →       http://127.0.0.1:${apiPort}`);
  if (useWorker) {
    console.log(`[dev] Worker (BullMQ):        health http://127.0.0.1:${workerHealthPort}/api/health`);
    console.log('[dev] Redis:                  enabled (worker started with API + Vite)');
  } else {
    console.log('[dev] Background jobs:        in-process in API (set REDIS_URL for BullMQ worker)');
  }
  console.log('[dev] ─────────────────────────────────────────');
  console.log('');

  const env = {
    ...process.env,
    PORT: String(apiPort),
    API_PORT: String(apiPort),
    VITE_DEV_SERVER_PORT: String(vitePort),
    VITE_API_PROXY_TARGET: '',
    WORKER_HEALTH_PORT: String(workerHealthPort),
  };

  if (!readEnvFromDotenv('EMR_OUTBOX_DEV_ACK')) {
    env.EMR_OUTBOX_DEV_ACK = '1';
  }

  const concurrentlyArgs = useWorker
    ? [
        'concurrently',
        '-n',
        'api,vite,worker',
        '-c',
        'blue,green,magenta',
        '--kill-others-on-fail',
        'npm run dev:backend',
        'node scripts/wait-for-api.mjs && npm run dev:frontend',
        'npm run worker',
      ]
    : [
        'concurrently',
        '-n',
        'api,vite',
        '-c',
        'blue,green',
        '--kill-others-on-fail',
        'npm run dev:backend',
        'node scripts/wait-for-api.mjs && npm run dev:frontend',
      ];

  const child = spawn('npx', concurrentlyArgs, {
    cwd: pkgRoot,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  }
}

main().catch((err) => {
  console.error('[dev] failed to start:', err);
  process.exit(1);
});
