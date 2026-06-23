'use strict';

/**
 * CollectRx — Electron main process
 *
 * Dev mode:  loads http://localhost:5173/login (Vite)
 * Prod mode: COLLECTRX_DASHBOARD_URL (or dashboard-url.txt), defaulting path / → /dashboard
 */

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  shell,
} = require('electron');
const path  = require('path');
const fs    = require('fs');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');

// Load repo-root .env in development so COLLECTRX_* applies when launching `electron .` from the repo.
if (!app.isPackaged) {
  try {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  } catch (_) {
    /* optional */
  }
}

function readApiOriginFromUserData() {
  if (app.isPackaged !== true) return '';
  try {
    const p = path.join(app.getPath('userData'), 'api-origin.txt');
    const raw = fs.readFileSync(p, 'utf8');
    const line = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#'));
    if (line && /^https?:\/\//i.test(line)) return line.replace(/\/$/, '');
  } catch (_) {
    /* missing file */
  }
  return '';
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

// ── Config ───────────────────────────────────────────────────────────────────
const isDev = !app.isPackaged;

/** Public dashboard when COLLECTRX_DASHBOARD_URL / dashboard-url.txt are unset. */
const DEFAULT_PROD_DASHBOARD = 'https://www.collectrx.ca';

function readDashboardUrlFromUserData() {
  if (isDev) return null;
  try {
    const p = path.join(app.getPath('userData'), 'dashboard-url.txt');
    const raw = fs.readFileSync(p, 'utf8');
    const line = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#'));
    if (line && /^https?:\/\//i.test(line)) return line;
  } catch (_) {
    /* missing file */
  }
  return null;
}

function resolveDashboardUrl() {
  if (isDev) return { url: 'http://localhost:5173', source: 'dev' };
  const envUrl = process.env.COLLECTRX_DASHBOARD_URL?.trim();
  if (envUrl) return { url: envUrl, source: 'env' };
  const fromFile = readDashboardUrlFromUserData();
  if (fromFile) return { url: fromFile, source: 'file' };
  return { url: DEFAULT_PROD_DASHBOARD, source: 'default' };
}

const _dash = resolveDashboardUrl();
const DASHBOARD_URL = _dash.url;

function dashboardIsRemoteHttps() {
  try {
    const dash = new URL(DASHBOARD_URL);
    return (
      dash.protocol === 'https:' &&
      dash.hostname !== 'localhost' &&
      dash.hostname !== '127.0.0.1'
    );
  } catch {
    return false;
  }
}

/**
 * When the window loads https://www.collectrx.ca but api-origin is still http://127.0.0.1:3000
 * (dev .env or leftover api-origin.txt), Chromium blocks mixed content and API calls fail.
 * Drop loopback origins in that case so the renderer uses resolveApiUrl fallbacks (Railway API).
 */
function sanitizeApiOriginForDashboard(apiOrigin) {
  const o = (apiOrigin || '').trim().replace(/\/$/, '');
  if (!o || !dashboardIsRemoteHttps()) return o;
  try {
    const u = new URL(o);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return '';
  } catch {
    return o;
  }
  return o;
}

// Renderer resolves /api against this origin when set (overrides Vite-inlined VITE_API_ORIGIN).
ipcMain.on('crx-get-api-origin', (event) => {
  const fromEnv = sanitizeApiOriginForDashboard(process.env.COLLECTRX_API_ORIGIN || '');
  const fromFile = sanitizeApiOriginForDashboard(readApiOriginFromUserData());
  event.returnValue = fromEnv || fromFile || '';
});

/**
 * Practice home lives at /dashboard. Signed-in sessions land there; logged-out users
 * are redirected to /login by the app router.
 */
function electronWindowEntryUrl(baseUrl) {
  const override = process.env.COLLECTRX_DASHBOARD_START_PATH?.trim();
  try {
    const u = new URL(baseUrl);
    if (override) {
      u.pathname = override.startsWith('/') ? override : `/${override}`;
      return u.toString();
    }
    const pathOnly = (u.pathname || '/').replace(/\/+$/, '') || '/';
    if (pathOnly === '/') {
      u.pathname = '/dashboard';
    }
    return u.toString();
  } catch {
    return baseUrl;
  }
}

const WINDOW_ENTRY_URL = electronWindowEntryUrl(DASHBOARD_URL);

if (!isDev && _dash.source === 'default') {
  const hintPath = path.join(app.getPath('userData'), 'dashboard-url.txt');
  console.warn(
    `[CollectRx] Dashboard URL not configured — using placeholder (Railway may show 404).\n` +
      `  Set env COLLECTRX_DASHBOARD_URL when launching, or create this file with one line (your public app URL):\n` +
      `  ${hintPath}`
  );
}

// Dev: resolve directly to desktop/services/abeldent-sync.js
// Packaged: electron-builder copies desktop/ into resources/app/desktop/
const SYNC_SERVICE_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'app', 'desktop', 'services', 'abeldent-sync.js')
  : path.join(__dirname, '..', 'desktop', 'services', 'abeldent-sync.js');

// ── State ────────────────────────────────────────────────────────────────────
let mainWindow  = null;
let tray        = null;
let syncProcess = null;
let syncStatus  = 'starting';
let syncLastMsg = 'Starting…';
app.isQuitting  = false;

// ── Tray icons ───────────────────────────────────────────────────────────────
function makeDotIcon(hex) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">
    <circle cx="10" cy="10" r="8" fill="${hex}"/>
  </svg>`;
  return nativeImage.createFromDataURL(
    'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
  );
}

const ICONS = {
  healthy  : makeDotIcon('#22c55e'),
  error    : makeDotIcon('#ef4444'),
  starting : makeDotIcon('#f59e0b'),
};

const TOOLTIPS = {
  healthy  : 'CollectRx — Sync active',
  error    : 'CollectRx — Sync error',
  starting : 'CollectRx — Starting…',
};

// ── Tray ─────────────────────────────────────────────────────────────────────
function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Open CollectRx', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    { label: `Sync: ${syncStatus}`, enabled: false },
    { label: 'Trigger manual sync', click: () => triggerManualSync() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
}

function setStatus(status, message) {
  syncStatus  = status;
  syncLastMsg = message || TOOLTIPS[status] || status;
  if (!tray) return;
  tray.setImage(ICONS[status] || ICONS.starting);
  tray.setToolTip(TOOLTIPS[status] || 'CollectRx');
  tray.setContextMenu(buildTrayMenu());
  mainWindow?.webContents.send('sync-status-changed', { status, message: syncLastMsg });
}

function createTray() {
  tray = new Tray(ICONS.starting);
  tray.setToolTip(TOOLTIPS.starting);
  tray.setContextMenu(buildTrayMenu());
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

// ── BrowserWindow ─────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width  : 1280,
    height : 820,
    minWidth  : 960,
    minHeight : 600,
    title  : 'CollectRx',
    show   : false,
    webPreferences: {
      preload          : path.join(__dirname, 'preload.js'),
      contextIsolation : true,
      nodeIntegration  : false,
      sandbox          : true,
      webSecurity      : true,
    },
  });

  mainWindow.loadURL(WINDOW_ENTRY_URL);
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Minimise to tray on close
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); mainWindow.hide(); }
  });

  // Open external links in OS browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error(`[Window] Failed to load: ${code} ${desc}`);
    if (isDev) {
      // Retry after 2s — Vite dev server may still be starting
      setTimeout(() => mainWindow?.loadURL(WINDOW_ENTRY_URL), 2000);
    }
  });
}

// ── Sync service ──────────────────────────────────────────────────────────────
function spawnSyncService() {
  if (!fs.existsSync(SYNC_SERVICE_PATH)) {
    console.log('[Sync] Service not found at', SYNC_SERVICE_PATH, '— skipping');
    setStatus('starting', 'Sync service not yet configured');
    return;
  }

  console.log('[Sync] Spawning', SYNC_SERVICE_PATH);
  setStatus('starting', 'Sync service starting…');

  syncProcess = spawn(process.execPath, [SYNC_SERVICE_PATH], {
    env        : { ...process.env },
    stdio      : ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  syncProcess.stdout.on('data', (chunk) => {
    const line = chunk.toString().trim();
    if (line.includes('SYNC_OK'))    setStatus('healthy', line);
    if (line.includes('SYNC_ERROR')) setStatus('error',   line);
  });

  syncProcess.stderr.on('data', (chunk) => {
    const line = chunk.toString().trim();
    console.error('[Sync err]', line);
    if (line.toLowerCase().includes('error')) setStatus('error', line.slice(0, 120));
  });

  syncProcess.on('exit', (code) => {
    syncProcess = null;
    if (!app.isQuitting) {
      setStatus('error', `Sync stopped (code ${code}). Restarting in 30s…`);
      setTimeout(spawnSyncService, 30_000);
    }
  });
}

function triggerManualSync() {
  if (syncProcess && !syncProcess.killed) {
    syncProcess.stdin?.write('SYNC_NOW\n');
  }
}

// ── IPC ───────────────────────────────────────────────────────────────────────
ipcMain.handle('get-sync-status',    () => ({ status: syncStatus, message: syncLastMsg }));
ipcMain.handle('trigger-manual-sync',() => { triggerManualSync(); return true; });
ipcMain.handle('get-app-version',    () => app.getVersion());

// ── Auto-updater ──────────────────────────────────────────────────────────────
function setupAutoUpdater() {
  // Only run in packaged app — electron-updater crashes in dev mode
  if (isDev) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    console.log(`[Updater] Update available: ${info.version}`);
    mainWindow?.webContents.send('update-available', { version: info.version });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[Updater] Update downloaded: ${info.version}`);
    mainWindow?.webContents.send('update-downloaded', { version: info.version });
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err.message);
  });

  // Check once on start, then every 4 hours
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 4 * 60 * 60 * 1000);
}

// ── Startup health scan (smoke + email on failure) ───────────────────────────
function resolveApiOriginForScan() {
  const fromUserData = readApiOriginFromUserData();
  if (fromUserData) return fromUserData;
  const env = process.env.COLLECTRX_API_ORIGIN?.trim();
  if (env && /^https?:\/\//i.test(env)) return env.replace(/\/$/, '');
  if (isDev) return 'http://127.0.0.1:3000';
  return DEFAULT_PROD_DASHBOARD.replace(/\/$/, '');
}

function runStartupHealthScan() {
  if (['0', 'false', 'no'].includes(String(process.env.STARTUP_HEALTH_SCAN_ENABLED || '').toLowerCase())) {
    return;
  }
  const script = path.join(__dirname, '..', 'scripts', 'startup-scan.mjs');
  if (!fs.existsSync(script)) return;
  const apiOrigin = resolveApiOriginForScan();
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, COLLECTRX_API_ORIGIN: apiOrigin },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: true,
  });
  child.stdout?.on('data', (d) => console.log('[startup-scan]', d.toString().trim()));
  child.stderr?.on('data', (d) => console.error('[startup-scan]', d.toString().trim()));
  child.unref();
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createTray();
  createWindow();
  spawnSyncService();
  setupAutoUpdater();
  runStartupHealthScan();
});

app.on('second-instance', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});

app.on('window-all-closed', (e) => e.preventDefault()); // stay in tray on Windows

app.on('before-quit', () => {
  app.isQuitting = true;
  syncProcess?.kill('SIGTERM');
});
