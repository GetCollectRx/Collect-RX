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

const COLLECTRX_DEFAULT_REMOTE_API = 'https://www.collectrx.ca';

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
const mode = devApiTarget();

if (mode === 'remote') {
  freeCollectRxDevPorts({ apiPort: readPortFromEnvFile('PORT', 3000), vitePort: preferredVite });
  const vitePort = pickFreePort(preferredVite);
  const remoteApi = resolveRemoteApiOrigin();
  const publicSite =
    normalizeOrigin(readEnvFromDotenv('PUBLIC_APP_URL')) || 'https://www.collectrx.ca';

  console.log('');
  console.log('[dev] ─────────────────────────────────────────');
  console.log('[dev] Mode: production API (collectrx.ca stack)');
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

  const apiPort = pickFreePort(preferredApi);
  const vitePort = pickFreePort(preferredVite);

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
  console.log('[dev] Background jobs: in-process in API (no Redis/worker needed)');
  console.log('[dev] ─────────────────────────────────────────');
  console.log('');

  const env = {
    ...process.env,
    PORT: String(apiPort),
    API_PORT: String(apiPort),
    VITE_DEV_SERVER_PORT: String(vitePort),
    VITE_API_PROXY_TARGET: '',
  };

  const child = spawn(
    'npx',
    [
      'concurrently',
      '-n',
      'api,vite',
      '-c',
      'blue,green',
      'npm run dev:backend',
      'npm run dev:frontend',
    ],
    {
      cwd: pkgRoot,
      env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    },
  );

  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
}
