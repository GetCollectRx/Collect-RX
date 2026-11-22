#!/usr/bin/env node
/**
 * Launch the packaged CollectRx desktop app and check it really comes up.
 *
 *   node scripts/desktop-smoke.mjs --exe <path to CollectRx executable> --out <dir>
 *
 * The app is pointed at a local stub API, so nothing here touches production.
 * It then talks to the app over the Chrome DevTools protocol and checks that:
 *   1. the bundled UI server answers on loopback,
 *   2. the window shows the CollectRx sign-in screen (not an error page),
 *   3. /api calls from the window reach the stub, which proves the proxy works.
 * A screenshot of the window is written to the output directory.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import WebSocket from 'ws';

const BUNDLED_UI_PORT = 17341;
const START_TIMEOUT_MS = 90_000;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const exe = arg('exe');
const outDir = path.resolve(arg('out', 'desktop-smoke-out'));
const debugPort = Number(arg('debug-port', '9333'));
if (!exe) {
  console.error('usage: desktop-smoke.mjs --exe <executable> [--out <dir>] [--debug-port <n>]');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
function record(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function getText(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      })
      .on('error', reject);
  });
}

async function waitFor(label, fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${label}${lastError ? ` (${lastError})` : ''}`);
}

/** Minimal CDP client: one socket, request/response by id. */
function cdpClient(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  socket.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    const waiter = msg.id ? pending.get(msg.id) : undefined;
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.error) waiter.reject(new Error(msg.error.message));
    else waiter.resolve(msg.result);
  });
  const ready = new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return {
    ready,
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
}

const apiHits = [];
const stub = http.createServer((req, res) => {
  apiHits.push(`${req.method} ${req.url}`);
  res.setHeader('content-type', 'application/json');
  if (req.url && req.url.startsWith('/health')) {
    res.end('{"ok":true}');
    return;
  }
  // Signed out, which is what the sign-in screen expects to hear.
  res.statusCode = 401;
  res.end('{"error":"unauthorized"}');
});

let child;
let exitCode = 1;
try {
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
  const stubPort = stub.address().port;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'crx-smoke-'));

  child = spawn(exe, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${userData}`], {
    env: { ...process.env, COLLECTRX_API_ORIGIN: `http://127.0.0.1:${stubPort}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  child.on('exit', (code) => {
    log += `\n[process exited with code ${code}]`;
  });

  const ui = await waitFor(
    'the bundled UI server',
    async () => {
      const r = await getText(`http://127.0.0.1:${BUNDLED_UI_PORT}/`);
      return r.status === 200 && r.body.includes('<div id="root"') ? r : null;
    },
    START_TIMEOUT_MS,
  );
  record('bundled UI server answers on loopback', true, `port ${BUNDLED_UI_PORT}, ${ui.body.length} bytes`);

  const target = await waitFor(
    'the app window',
    async () => {
      const r = await getText(`http://127.0.0.1:${debugPort}/json/list`);
      const pages = JSON.parse(r.body).filter((t) => t.type === 'page' && t.url.startsWith(`http://127.0.0.1:${BUNDLED_UI_PORT}`));
      return pages[0] ?? null;
    },
    START_TIMEOUT_MS,
  );
  record('window loads the bundled UI', true, target.url);

  const cdp = cdpClient(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');

  const text = await waitFor(
    'the sign-in screen to render',
    async () => {
      const r = await cdp.send('Runtime.evaluate', {
        expression: 'document.body ? document.body.innerText : ""',
        returnByValue: true,
      });
      const value = String(r.result.value || '');
      return /sign in|log in|email|password/i.test(value) ? value : null;
    },
    30_000,
  );
  record('sign-in screen is shown', true, text.replace(/\s+/g, ' ').slice(0, 80));

  const pathname = await cdp.send('Runtime.evaluate', { expression: 'location.pathname', returnByValue: true });
  record('signed-out user lands on /login', String(pathname.result.value) === '/login', String(pathname.result.value));

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, 'window.png'), Buffer.from(shot.data, 'base64'));
  record('screenshot captured', true, path.join(outDir, 'window.png'));

  await waitFor('an API call to reach the stub', async () => apiHits.some((h) => h.includes('/api/')), 15_000);
  record('window API calls reach the API through the proxy', true, apiHits.find((h) => h.includes('/api/')));

  cdp.close();
  fs.writeFileSync(path.join(outDir, 'app.log'), log);
  exitCode = checks.every((c) => c.ok) ? 0 : 1;
} catch (err) {
  record('smoke test completed', false, err instanceof Error ? err.message : String(err));
  exitCode = 1;
} finally {
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ checks, apiHits: apiHits.slice(0, 20) }, null, 2));
  if (child && !child.killed) child.kill();
  stub.close();
  await sleep(500);
  console.log(exitCode === 0 ? 'DESKTOP-SMOKE: PASS' : 'DESKTOP-SMOKE: FAIL');
  process.exit(exitCode);
}
