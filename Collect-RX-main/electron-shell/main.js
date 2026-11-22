'use strict';

/**
 * CollectRx — Electron main process
 *
 * Dev mode:  loads http://localhost:5173/login (Vite) or hosted Fly when COLLECTRX_USE_HOSTED
 * Prod mode: bundled UI on 127.0.0.1 + local proxy to Fly API (complete desktop app)
 */

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  shell,
  Notification,
} = require('electron');
const { createHandoffNudge } = require('./handoffNudge.cjs');
const path  = require('path');
const fs    = require('fs');
const { spawn } = require('child_process');
const { loadAgentConfig, applyAgentConfigToEnv } = require('./loadAgentConfig.cjs');
const { startDesktopServer } = require('./desktopServer.cjs');
const {
  COLLECTRX_PROD_API_ORIGIN,
  COLLECTRX_PROD_APP_ORIGIN,
} = require('./origins.cjs');

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

/** Windows login startup registers CollectRx.exe --hidden (see installer.nsh). */
const startHidden = process.argv.includes('--hidden');

// ── Config ───────────────────────────────────────────────────────────────────
const isDev = !app.isPackaged;

/** Public dashboard when COLLECTRX_DASHBOARD_URL / dashboard-url.txt are unset. */
const DEFAULT_PROD_DASHBOARD = COLLECTRX_PROD_APP_ORIGIN;

function useHostedApp() {
  if (!isDev) return true;
  const local = String(process.env.COLLECTRX_DEV_LOCAL || '').toLowerCase();
  if (local === '1' || local === 'true' || local === 'yes') return false;
  const hosted = String(process.env.COLLECTRX_USE_HOSTED || '').toLowerCase();
  if (hosted === '1' || hosted === 'true' || hosted === 'yes') return true;
  // Default unpackaged Electron to hosted Fly — no local npm stack required.
  return true;
}

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
  if (isDev && !useHostedApp()) return { url: 'http://localhost:5173', source: 'dev-local' };
  if (isDev) return { url: COLLECTRX_PROD_APP_ORIGIN, source: 'dev-hosted' };
  const envUrl = process.env.COLLECTRX_DASHBOARD_URL?.trim();
  if (envUrl) return { url: envUrl, source: 'env' };
  const fromFile = readDashboardUrlFromUserData();
  if (fromFile) return { url: fromFile, source: 'file' };
  return { url: DEFAULT_PROD_DASHBOARD, source: 'default' };
}

let DASHBOARD_URL = '';
let WINDOW_ENTRY_URL = '';
let bundledAppUrl = null;
let desktopServerHandle = null;

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
 * Drop loopback origins in that case so the renderer uses resolveApiUrl fallbacks (hosted API).
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
  if (bundledAppUrl) {
    event.returnValue = '';
    return;
  }
  const fromEnv = sanitizeApiOriginForDashboard(process.env.COLLECTRX_API_ORIGIN || '');
  const fromFile = sanitizeApiOriginForDashboard(readApiOriginFromUserData());
  const fallback =
    isDev && useHostedApp() ? COLLECTRX_PROD_API_ORIGIN : '';
  event.returnValue = fromEnv || fromFile || fallback || '';
});

/**
 * Practice home lives at /dashboard. Signed-in sessions land there; logged-out users
 * are redirected to /login by the app router.
 */
function electronWindowEntryUrl(baseUrl, opts = {}) {
  const { preferLogin = false } = opts;
  const override = process.env.COLLECTRX_DASHBOARD_START_PATH?.trim();
  try {
    const u = new URL(baseUrl);
    if (override) {
      u.pathname = override.startsWith('/') ? override : `/${override}`;
      return u.toString();
    }
    if (preferLogin) {
      u.pathname = '/login';
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

function resolveDistDir() {
  return path.join(__dirname, '..', 'dist');
}

async function startBundledDesktopServer() {
  const distDir = resolveDistDir();
  const apiOrigin =
    process.env.COLLECTRX_API_ORIGIN?.trim() ||
    readApiOriginFromUserData() ||
    COLLECTRX_PROD_API_ORIGIN;
  const handle = await startDesktopServer({ distDir, apiOrigin });
  desktopServerHandle = handle;
  bundledAppUrl = `http://127.0.0.1:${handle.port}`;
  DASHBOARD_URL = bundledAppUrl;
  WINDOW_ENTRY_URL = electronWindowEntryUrl(bundledAppUrl, { preferLogin: true });
  console.log(`[CollectRx] Bundled UI at ${bundledAppUrl} → API ${apiOrigin}`);
  return bundledAppUrl;
}

async function initDashboardTarget() {
  if (!isDev) {
    try {
      await startBundledDesktopServer();
      return;
    } catch (err) {
      console.error('[CollectRx] Bundled UI unavailable — falling back to hosted dashboard', err.message);
      bundledAppUrl = null;
    }
  }
  const dash = resolveDashboardUrl();
  DASHBOARD_URL = dash.url;
  WINDOW_ENTRY_URL = electronWindowEntryUrl(DASHBOARD_URL);
  if (!isDev && dash.source === 'default') {
    const hintPath = path.join(app.getPath('userData'), 'dashboard-url.txt');
    console.warn(
      `[CollectRx] Dashboard URL not configured — using default ${DEFAULT_PROD_DASHBOARD}.\n` +
        `  Set env COLLECTRX_DASHBOARD_URL when launching, or create this file with one line (your public app URL):\n` +
        `  ${hintPath}`,
    );
  }
}

// WINDOW_ENTRY_URL set in initDashboardTarget() before createWindow()

// ── State ────────────────────────────────────────────────────────────────────
let mainWindow  = null;
let tray        = null;
let loadFallbackAttempted = false;
app.isQuitting  = false;

const OFFLINE_PAGE = path.join(__dirname, 'offline.html');

// ── Tray icons ───────────────────────────────────────────────────────────────
function makeDotIcon(hex) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">
    <circle cx="10" cy="10" r="8" fill="${hex}"/>
  </svg>`;
  return nativeImage.createFromDataURL(
    'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
  );
}

const TRAY_ICON = makeDotIcon('#22c55e');

// ── Tray ─────────────────────────────────────────────────────────────────────
function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Open CollectRx', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
}

function createTray() {
  tray = new Tray(TRAY_ICON);
  tray.setToolTip('CollectRx');
  tray.setContextMenu(buildTrayMenu());
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

function loadDashboardUrl() {
  if (!mainWindow) return;
  loadFallbackAttempted = false;
  mainWindow.loadURL(WINDOW_ENTRY_URL);
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
    backgroundColor: '#f0ece4',
    webPreferences: {
      preload          : path.join(__dirname, 'preload.js'),
      contextIsolation : true,
      nodeIntegration  : false,
      sandbox          : true,
      webSecurity      : true,
      backgroundThrottling: false,
    },
  });

  loadDashboardUrl();
  mainWindow.once('ready-to-show', () => {
    if (!startHidden) mainWindow.show();
  });

  // Minimise to tray on close
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); mainWindow.hide(); }
  });

  // Open external links in OS browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, validatedURL) => {
    console.error(`[Window] Failed to load: ${code} ${desc} (${validatedURL})`);
    if (isDev) {
      setTimeout(() => loadDashboardUrl(), 2000);
      return;
    }
    if (!loadFallbackAttempted && validatedURL && validatedURL.startsWith('http')) {
      loadFallbackAttempted = true;
      if (fs.existsSync(OFFLINE_PAGE)) {
        mainWindow.loadFile(OFFLINE_PAGE);
      }
    }
  });
}

// ── IPC ───────────────────────────────────────────────────────────────────────
ipcMain.handle('get-app-version',    () => app.getVersion());
ipcMain.handle('retry-dashboard-load', () => { loadDashboardUrl(); return true; });
// Only the app's own window may raise or clear the handoff alert.
const handoffNudge = createHandoffNudge({ Notification, getWindow: () => mainWindow });
function isFromMainWindow(event) {
  return Boolean(mainWindow) && event.sender === mainWindow.webContents;
}
ipcMain.handle('crx-handoff-alert-show', (event) => {
  if (!isFromMainWindow(event)) return false;
  handoffNudge.show();
  return true;
});
ipcMain.handle('crx-handoff-alert-clear', (event) => {
  if (!isFromMainWindow(event)) return false;
  handoffNudge.clear();
  return true;
});
ipcMain.handle('restart-to-update',  () => {
  if (!isDev) {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.quitAndInstall(false, true);
  }
  return true;
});

// ── Auto-updater ──────────────────────────────────────────────────────────────
function setupAutoUpdater() {
  // Only run in packaged app — electron-updater crashes in dev mode
  if (isDev) return;

  const { autoUpdater } = require('electron-updater');
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
  if (isDev && useHostedApp()) return COLLECTRX_PROD_API_ORIGIN;
  if (isDev) return 'http://127.0.0.1:3000';
  return COLLECTRX_PROD_API_ORIGIN;
}

function runStartupHealthScan() {
  if (['0', 'false', 'no'].includes(String(process.env.STARTUP_HEALTH_SCAN_ENABLED || '').toLowerCase())) {
    return;
  }
  const script = path.join(__dirname, '..', 'scripts', 'startup-scan.mjs');
  if (!fs.existsSync(script)) return;
  const apiOrigin = resolveApiOriginForScan();
  const child = spawn(process.execPath, [script], {
    env: {
      PATH                        : process.env.PATH,
      NODE_ENV                    : process.env.NODE_ENV,
      COLLECTRX_API_ORIGIN        : apiOrigin,
      PUBLIC_APP_URL              : process.env.PUBLIC_APP_URL,
      VITE_API_ORIGIN             : process.env.VITE_API_ORIGIN,
      SMOKE_BASE_URL              : process.env.SMOKE_BASE_URL,
      SERVER_URL                  : process.env.SERVER_URL,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: true,
  });
  child.stdout?.on('data', (d) => console.log('[startup-scan]', d.toString().trim()));
  child.stderr?.on('data', (d) => console.error('[startup-scan]', d.toString().trim()));
  child.unref();
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  const appRoot = path.join(__dirname, '..');
  applyAgentConfigToEnv(loadAgentConfig(appRoot));
  await initDashboardTarget();
  createTray();
  createWindow();
  setupAutoUpdater();
  runStartupHealthScan();
});

app.on('second-instance', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});

app.on('window-all-closed', (e) => e.preventDefault()); // stay in tray on Windows

app.on('before-quit', () => {
  app.isQuitting = true;
  if (desktopServerHandle) {
    void desktopServerHandle.close().catch(() => {});
    desktopServerHandle = null;
  }
});
