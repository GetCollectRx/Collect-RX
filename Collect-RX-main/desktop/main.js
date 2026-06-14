/**
 * CollectRx Desktop — Electron Main Process
 *
 * Thin shell around the Railway-hosted frontend.
 * Responsibilities:
 *   - BrowserWindow pointing at the Railway dashboard URL
 *   - System tray with green/red sync status icon
 *   - Spawns the AbelDent sync service as a utilityProcess child on startup
 *   - IPC handlers for sync trigger and carrier priority (forwarded to Railway)
 */

'use strict';

const {
  app,
  BrowserWindow,
  shell,
  Menu,
  Tray,
  nativeImage,
  ipcMain,
  utilityProcess,
} = require('electron');
const path = require('path');
const https = require('https');
const fs = require('fs');
const { URL } = require('url');

// Configuration
const isDev = !app.isPackaged;
const FRONTEND_URL = isDev
  ? 'http://localhost:5173'
  : (process.env.COLLECTRX_FRONTEND_URL || 'https://www.collectrx.ca');

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
      u.pathname = '/login';
    }
    return u.toString();
  } catch {
    return baseUrl;
  }
}

const WINDOW_ENTRY_URL = electronWindowEntryUrl(FRONTEND_URL);
const RAILWAY_URL = (process.env.RAILWAY_API_URL || '').replace(/\/$/, '');

// State
let mainWindow = null;
let tray = null;
let syncProcess = null;
let syncStatus = 'offline'; // 'syncing' | 'ok' | 'error' | 'offline'
app.isQuitting = false;

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

// Tray icon helpers
function loadTrayIcon(status) {
  const iconMap = {
    ok:      'tray-icon-green.png',
    syncing: 'tray-icon-green.png',
    error:   'tray-icon-red.png',
    offline: 'tray-icon-red.png',
  };
  const filename = iconMap[status] || 'tray-icon.png';
  const assetsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, 'assets');
  const specific = path.join(assetsDir, filename);
  const fallback = path.join(assetsDir, 'tray-icon.png');

  let icon = nativeImage.createFromPath(specific);
  if (icon.isEmpty()) icon = nativeImage.createFromPath(fallback);
  if (icon.isEmpty()) {
    // Create a simple colored dot as fallback
    const color = status === 'ok' || status === 'syncing' ? '#22c55e' : '#ef4444';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8" fill="${color}"/></svg>`;
    icon = nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
  }

  // Resize to system tray size
  if (!icon.isEmpty()) {
    icon = icon.resize({ width: 16, height: 16 });
  }
  return icon;
}

function statusLabel(status) {
  return {
    ok:      'AbelDent sync: connected',
    syncing: 'AbelDent sync: syncing...',
    error:   'AbelDent sync: error',
    offline: 'AbelDent sync: offline',
  }[status] || 'AbelDent sync: unknown';
}

// Sync status update
function updateSyncStatus(status, message) {
  syncStatus = status;

  if (tray) {
    tray.setImage(loadTrayIcon(status));
    tray.setToolTip(`CollectRx — ${statusLabel(status)}`);
    rebuildTrayMenu();
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sync-status', { status, message: message || null });
  }
}

// AbelDent sync service
function spawnSyncService() {
  const scriptPath = path.join(__dirname, 'services', 'abeldent-sync.js');

  if (!fs.existsSync(scriptPath)) {
    console.log('[Sync] Service not found at', scriptPath, '— skipping');
    updateSyncStatus('offline', 'Sync service not configured');
    return;
  }

  if (syncProcess) {
    try { syncProcess.kill(); } catch { /* already dead */ }
    syncProcess = null;
  }

  try {
    syncProcess = utilityProcess.fork(scriptPath, [], {
      serviceName: 'abeldent-sync',
      env: { ...process.env },
    });

    syncProcess.on('message', (msg) => {
      if (msg?.type === 'status') {
        updateSyncStatus(msg.status, msg.message);
      }
    });

    syncProcess.on('exit', (code) => {
      updateSyncStatus('error', `Sync process exited (code ${code})`);
      if (!app.isQuitting) {
        setTimeout(spawnSyncService, 60_000);
      }
    });

    updateSyncStatus('syncing');
  } catch (err) {
    console.error('[Sync] Failed to spawn service:', err.message);
    updateSyncStatus('offline', 'Failed to start sync service');
  }
}

// IPC handlers
ipcMain.handle('trigger-sync', () => {
  if (syncProcess) {
    syncProcess.postMessage({ type: 'trigger' });
    return { ok: true };
  }
  return { ok: false, error: 'Sync service not running' };
});

ipcMain.handle('get-sync-status', () => ({ status: syncStatus }));

ipcMain.handle('set-carrier-priority', async (_event, { carrier, date, token }) => {
  if (!RAILWAY_URL) {
    return { ok: false, error: 'RAILWAY_API_URL not configured' };
  }
  if (!token) {
    return { ok: false, error: 'Not authenticated' };
  }

  const VALID_CARRIERS = [
    'sun_life', 'canada_life', 'manulife',
    'green_shield', 'rbc_insurance', 'telus_adjudicare',
  ];
  if (carrier && !VALID_CARRIERS.includes(carrier)) {
    return { ok: false, error: 'Invalid carrier code' };
  }

  const body = Buffer.from(JSON.stringify({
    carrier,
    date: date || new Date().toISOString().split('T')[0],
  }));

  return new Promise((resolve) => {
    const endpoint = `${RAILWAY_URL}/api/queue/priority`;
    let parsed;
    try { parsed = new URL(endpoint); }
    catch { return resolve({ ok: false, error: 'Invalid RAILWAY_API_URL' }); }

    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length,
          'Authorization': `Bearer ${token}`,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(res.statusCode < 300 ? { ok: true, ...json } : { ok: false, error: json.error });
          } catch {
            resolve({ ok: false, error: `HTTP ${res.statusCode}` });
          }
        });
      }
    );
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.write(body);
    req.end();
  });
});

// Create main window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'CollectRx',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#fcfcfa',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('sync-status', { status: syncStatus, message: null });
  });

  mainWindow.loadURL(WINDOW_ENTRY_URL);

  // Retry in dev mode if Vite not ready
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error(`[Window] Failed to load: ${code} ${desc}`);
    if (isDev) {
      setTimeout(() => mainWindow?.loadURL(WINDOW_ENTRY_URL), 2000);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// System tray
function rebuildTrayMenu() {
  if (!tray) return;
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open CollectRx',
      click: () => {
        if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
        else createWindow();
      },
    },
    { type: 'separator' },
    {
      label: statusLabel(syncStatus),
      enabled: false,
    },
    {
      label: 'Sync now',
      click: () => {
        if (syncProcess) syncProcess.postMessage({ type: 'trigger' });
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(contextMenu);
}

function createTray() {
  tray = new Tray(loadTrayIcon('offline'));
  tray.setToolTip('CollectRx — starting...');

  rebuildTrayMenu();

  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    } else {
      createWindow();
    }
  });
}

// App menu
function buildMenu() {
  const template = [
    ...(process.platform === 'darwin'
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin'
          ? [{ type: 'separator' }, { role: 'front' }]
          : [{ role: 'close' }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// App lifecycle
app.whenReady().then(() => {
  buildMenu();
  createWindow();
  createTray();
  spawnSyncService();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});

app.on('window-all-closed', (e) => {
  e.preventDefault(); // Stay in tray
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (syncProcess) {
    try { syncProcess.kill(); } catch { /* ignore */ }
  }
});
