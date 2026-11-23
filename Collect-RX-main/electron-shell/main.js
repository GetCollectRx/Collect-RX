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
const zlib  = require('zlib');
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

// Dev: resolve directly to desktop/services/abeldent-sync.cjs
// Packaged: electron-builder copies desktop/ into resources/app/desktop/
const SYNC_SERVICE_PATH = path.join(__dirname, '..', 'desktop', 'services', 'abeldent-sync.cjs');

// ── State ────────────────────────────────────────────────────────────────────
let mainWindow  = null;
let tray        = null;
let syncProcess = null;
let syncStatus  = 'starting';
let syncLastMsg = 'Starting…';
let loadFallbackAttempted = false;
app.isQuitting  = false;

const OFFLINE_PAGE = path.join(__dirname, 'offline.html');

// ── Tray icons ───────────────────────────────────────────────────────────────
// nativeImage only decodes PNG/JPEG — createFromDataURL silently returns an
// empty image for image/svg+xml, which made the tray icon invisible. Rasterize
// the dot to a real PNG buffer instead of relying on an SVG decode.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgbaPixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type: RGBA
  ihdrData[10] = 0; // compression method
  ihdrData[11] = 0; // filter method
  ihdrData[12] = 0; // interlace method
  const ihdr = pngChunk('IHDR', ihdrData);

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    rgbaPixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = pngChunk('IDAT', zlib.deflateSync(raw));
  const iend = pngChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([signature, ihdr, idat, iend]);
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.substring(0, 2), 16),
    parseInt(clean.substring(2, 4), 16),
    parseInt(clean.substring(4, 6), 16),
  ];
}

function renderDotPng(hex, size = 20) {
  const [r, g, b] = hexToRgb(hex);
  const radius = size * 0.4;
  const center = size / 2;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - center;
      const dy = y + 0.5 - center;
      const inside = (dx * dx + dy * dy) <= radius * radius;
      const idx = (y * size + x) * 4;
      pixels[idx]     = r;
      pixels[idx + 1] = g;
      pixels[idx + 2] = b;
      pixels[idx + 3] = inside ? 255 : 0;
    }
  }
  return encodePng(size, size, pixels);
}

function makeDotIcon(hex) {
  return nativeImage.createFromBuffer(renderDotPng(hex), { width: 20, height: 20 });
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

// ── Sync service ──────────────────────────────────────────────────────────────
function spawnSyncService() {
  if (!process.env.ABELDENT_SCHEMA_MAP?.trim()) {
    console.log('[Sync] ABELDENT_SCHEMA_MAP not set — PMS connector idle (CSV / cloud mode)');
    setStatus('healthy', 'Cloud mode — no local PMS sync');
    return;
  }
  if (!fs.existsSync(SYNC_SERVICE_PATH)) {
    console.log('[Sync] Service not found at', SYNC_SERVICE_PATH, '— skipping');
    setStatus('starting', 'Sync service not yet configured');
    return;
  }

  console.log('[Sync] Spawning', SYNC_SERVICE_PATH);
  setStatus('starting', 'Sync service starting…');

  syncProcess = spawn(process.execPath, [SYNC_SERVICE_PATH], {
    env: {
      PATH                        : process.env.PATH,
      NODE_ENV                    : process.env.NODE_ENV,
      ABELDENT_SERVER             : process.env.ABELDENT_SERVER,
      ABELDENT_DATABASE           : process.env.ABELDENT_DATABASE,
      ABELDENT_PRACTICE_ID        : process.env.ABELDENT_PRACTICE_ID,
      ABELDENT_SCHEMA_MAP         : process.env.ABELDENT_SCHEMA_MAP,
      ABELDENT_MIN_DAYS           : process.env.ABELDENT_MIN_DAYS,
      ABELDENT_MIN_DAYS_BALANCE   : process.env.ABELDENT_MIN_DAYS_BALANCE,
      ABELDENT_PATIENT_LEDGER_TABLE: process.env.ABELDENT_PATIENT_LEDGER_TABLE,
      SCHEMA_MAP_PATH             : process.env.SCHEMA_MAP_PATH,
      COLLECTRX_API_URL           : process.env.COLLECTRX_API_URL || COLLECTRX_PROD_API_ORIGIN,
      COLLECTRX_API_TOKEN         : process.env.COLLECTRX_API_TOKEN || process.env.COLLECTRX_CONNECTOR_TOKEN,
      COLLECTRX_CONNECTOR_TOKEN   : process.env.COLLECTRX_CONNECTOR_TOKEN,
      SYNC_INTERVAL_MINUTES       : process.env.SYNC_INTERVAL_MINUTES,
    },
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
    // Sanitized only — stderr can carry PHI field values from DB/Prisma errors.
    console.error('[Sync err]', line.replace(/\S+@\S+/g, '[redacted]').slice(0, 200));
    if (line.toLowerCase().includes('error')) setStatus('error', 'Sync error — check logs');
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
  if (desktopServerHandle) {
    void desktopServerHandle.close().catch(() => {});
    desktopServerHandle = null;
  }
});
