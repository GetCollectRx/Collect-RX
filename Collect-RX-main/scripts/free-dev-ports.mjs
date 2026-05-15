#!/usr/bin/env node
/**
 * Stop leftover CollectRx dev processes on API + Vite ports.
 * Only kills listeners whose command line is under this repo.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repoRoot = path.resolve(pkgRoot, '..');

const ROOT_MARKERS = [repoRoot, pkgRoot].filter(Boolean);

export function readEnvFromDotenv(name) {
  const envPath = path.join(pkgRoot, '.env');
  if (!fs.existsSync(envPath)) return '';
  const m = fs.readFileSync(envPath, 'utf8').match(new RegExp(`^${name}=(.+)$`, 'm'));
  if (!m) return '';
  return m[1].trim().replace(/^["']|["']$/g, '');
}

export function readPortFromEnvFile(name, fallback) {
  const raw = readEnvFromDotenv(name);
  if (raw && /^\d{1,5}$/.test(raw)) return Number(raw);
  return fallback;
}

export function pidsOnPort(port) {
  try {
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, { encoding: 'utf8' }).trim();
    return out ? out.split('\n').map((s) => parseInt(s, 10)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function cmdForPid(pid) {
  try {
    return execSync(`ps -p ${pid} -o command=`, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

export function isCollectRxDev(cmd) {
  if (!cmd) return false;
  const inRepo = ROOT_MARKERS.some((root) => cmd.includes(root));
  if (!inRepo) return false;
  return (
    cmd.includes('src/server/index.ts') ||
    cmd.includes('tsx watch') ||
    cmd.includes('/vite') ||
    cmd.includes('node_modules/.bin/vite') ||
    cmd.includes('scripts/dev.mjs')
  );
}

/** @returns {number} processes stopped */
export function freeCollectRxDevPorts({ apiPort, vitePort }) {
  let stopped = 0;
  for (const port of [apiPort, vitePort]) {
    for (const pid of pidsOnPort(port)) {
      const cmd = cmdForPid(pid);
      if (!isCollectRxDev(cmd)) continue;
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`[free-dev-ports] Stopped PID ${pid} on port ${port}`);
        stopped++;
      } catch {
        /* already gone */
      }
    }
  }
  if (stopped > 0 && process.platform !== 'win32') {
    try {
      execSync('sleep 0.4', { stdio: 'ignore' });
    } catch {
      /* ignore */
    }
  }
  return stopped;
}

export function isPortListening(port) {
  return pidsOnPort(port).length > 0;
}

/** First free port in [preferred, preferred + maxAttempts). */
export function pickFreePort(preferred, maxAttempts = 25) {
  for (let p = preferred; p < preferred + maxAttempts; p++) {
    if (!isPortListening(p)) return p;
  }
  throw new Error(`No free TCP port found in range ${preferred}–${preferred + maxAttempts - 1}`);
}

function main() {
  const apiPort = readPortFromEnvFile('PORT', 3000);
  const vitePort = readPortFromEnvFile('VITE_PORT', 5173);
  const stopped = freeCollectRxDevPorts({ apiPort, vitePort });
  if (stopped === 0) {
    console.log('[free-dev-ports] No stale CollectRx dev listeners on', apiPort, 'or', vitePort);
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main();
}
