'use strict';

/**
 * CollectRx — Electron main process
 *
 * Phase 4 additions:
 *   - Exponential backoff on sync restart (30s → 1m → 2m → … → 5m cap)
 *   - Last-sync timestamp shown in tray menu
 *   - Native notification after 30 min of consecutive sync failure
 *   - Windows startup registration (auto-launch minimized)
 *   - IPC input validation/sanitization
 *   - Changelog fetch from GitHub on update-available
 *   - App settings (AbelDent config) stored in userData/config.json
 */

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  Notification,
  ipcMain,
  dialog,
  shell,
} = require('electron');

/** User data dir is ~/Library/Application Support/<name> (macOS) or %APPDATA%\<name> (Windows). Must run before any getPath('userData'). */
app.setName('CollectRx');

const path  = require('path');
const fs    = require('fs');
const https = require('https');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');
const net  = require('net');
const http = require('http');

// ── Single instance ──────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

// ── Config ───────────────────────────────────────────────────────────────────
const isDev = !app.isPackaged;

/** Dev: Vite dev server. Packaged: embedded API + static UI, or optional remote HTTPS URL. */
const DASHBOARD_URL_DEV = 'http://localhost:5173';

let backendChild = null;

function readDashboardUrlFromFile() {
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
    /* missing */
  }
  return null;
}

/** First launch: template for DATABASE_URL / JWT (embedded server). Same folder as config.json. */
function ensureCollectrxEnvPlaceholder() {
  const userData = app.getPath('userData');
  try {
    fs.mkdirSync(userData, { recursive: true });
    const envFile = path.join(userData, 'collectrx.env');
    if (!fs.existsSync(envFile)) {
      fs.writeFileSync(
        envFile,
        [
          '# CollectRx desktop — PostgreSQL (Railway, local Postgres, etc.)',
          'DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE',
          '',
          '# Required for staff login tokens',
          'JWT_SECRET=replace-with-a-long-random-string',
          '',
          '# Optional: use a hosted CollectRx URL instead of the built-in dashboard —',
          '# one https:// line in dashboard-url.txt in this folder, or COLLECTRX_DASHBOARD_URL',
          '# Tray menu: Open settings folder…',
          '',
        ].join('\n'),
        'utf8',
      );
      console.log('[CollectRx] Created', envFile);
    }
  } catch (e) {
    console.error('[CollectRx] collectrx.env:', e.message);
  }
}

function openCollectrxUserDataFolder() {
  const dir = app.getPath('userData');
  shell.openPath(dir).then((err) => {
    if (err) console.error('[CollectRx] openPath userData:', err);
  });
}

function revealCollectrxEnvInShell() {
  ensureCollectrxEnvPlaceholder();
  const envFile = path.join(app.getPath('userData'), 'collectrx.env');
  if (fs.existsSync(envFile)) shell.showItemInFolder(envFile);
  else openCollectrxUserDataFolder();
}

function mergeCollectrxEnvFile(envFilePath, env) {
  try {
    if (!fs.existsSync(envFilePath)) return;
    const raw = fs.readFileSync(envFilePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (k) env[k] = v;
    }
  } catch (e) {
    console.error('[CollectRx] env merge:', e.message);
  }
}

const SYNC_SERVICE_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'sync-service', 'abeldent-sync.js')
  : path.join(__dirname, '..', 'desktop', 'services', 'abeldent-sync.js');

// ── App settings (persisted to userData/config.json) ─────────────────────────
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('[Config] Failed to read config:', e.message);
  }
  return {};
}

function writeConfig(updates) {
  try {
    const current = readConfig();
    const merged  = { ...current, ...updates };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');
    return merged;
  } catch (e) {
    console.error('[Config] Failed to write config:', e.message);
    return null;
  }
}

/** Optional: load hosted CollectRx from HTTPS instead of embedded local server. */
function getRemoteDashboardUrl() {
  if (isDev) return null;
  const envRemote =
    process.env.COLLECTRX_REMOTE_DASHBOARD?.trim() ||
    process.env.COLLECTRX_DASHBOARD_URL?.trim();
  if (envRemote && /^https?:\/\//i.test(envRemote)) return envRemote;
  const cfg = (readConfig().remoteDashboardUrl ?? '').trim();
  if (cfg && /^https?:\/\//i.test(cfg)) return cfg;
  return readDashboardUrlFromFile();
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const p = typeof addr === 'object' && addr ? addr.port : 0;
      s.close(() => resolve(p));
    });
    s.on('error', reject);
  });
}

function waitForHealth(port, maxAttempts = 80) {
  return new Promise((resolve) => {
    let n = 0;
    const tryOnce = () => {
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        if (res.statusCode === 200) resolve(true);
        else if (++n < maxAttempts) setTimeout(tryOnce, 300);
        else resolve(false);
      });
      req.on('error', () => {
        if (++n < maxAttempts) setTimeout(tryOnce, 300);
        else resolve(false);
      });
      req.setTimeout(2_000, () => {
        req.destroy();
        if (++n < maxAttempts) setTimeout(tryOnce, 300);
        else resolve(false);
      });
    };
    tryOnce();
  });
}

async function startEmbeddedBackend() {
  const appPath = app.getAppPath();
  const userData = app.getPath('userData');
  const serverEntry = path.join(appPath, 'desktop-backend', 'server.cjs');
  const envFile = path.join(userData, 'collectrx.env');

  if (!fs.existsSync(serverEntry)) {
    console.error('[CollectRx] Missing bundled server:', serverEntry);
    return null;
  }

  const port = await getFreePort();
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    COLLECTRX_DESKTOP: '1',
    NODE_ENV: isDev ? 'development' : 'production',
    PORT: String(port),
    COLLECTRX_DIST_DIR: path.join(appPath, 'dist'),
  };
  mergeCollectrxEnvFile(envFile, env);

  backendChild = spawn(process.execPath, [serverEntry], {
    env,
    cwd: appPath,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backendChild.stdout?.on('data', (d) => console.log('[backend]', d.toString().trimEnd()));
  backendChild.stderr?.on('data', (d) => console.error('[backend]', d.toString().trimEnd()));
  backendChild.on('exit', (code, sig) => {
    console.log('[CollectRx backend] exit', code, sig || '');
    backendChild = null;
  });

  const ok = await waitForHealth(port);
  if (!ok) {
    console.error('[CollectRx] Backend not healthy on port', port);
    try {
      backendChild.kill('SIGTERM');
    } catch (_) { /* */ }
    backendChild = null;
    return null;
  }
  return port;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildRemoteSetupHtml() {
  const userData = app.getPath('userData');
  const dashFile = path.join(userData, 'dashboard-url.txt');
  const envFile = path.join(userData, 'collectrx.env');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>CollectRx — Remote URL</title>
<style>body{font-family:system-ui;max-width:40rem;margin:2rem auto;padding:0 1rem;line-height:1.5}
button{margin:0.25rem 0.5rem 0.25rem 0;padding:0.45rem 0.85rem;font:inherit;cursor:pointer;border-radius:8px;border:1px solid #ccc;background:#f8fafc}
pre{background:#f4f4f5;padding:1rem;border-radius:8px;overflow:auto;font-size:0.85rem}</style>
</head><body>
<h1>Use a hosted CollectRx URL</h1>
<p>Add one <code>https://</code> line to <strong>dashboard-url.txt</strong> (in your CollectRx settings folder), or set environment variable <code>COLLECTRX_DASHBOARD_URL</code>, then restart the app.</p>
<pre>${escHtml(dashFile)}</pre>
<p>Built-in dashboard instead: edit <code>collectrx.env</code> in the same folder (set <code>DATABASE_URL</code> and <code>JWT_SECRET</code>), and remove or empty the remote override.</p>
<pre>${escHtml(envFile)}</pre>
<p>
<button type="button" id="reveal-env">Reveal collectrx.env</button>
<button type="button" id="open-folder">Open settings folder</button>
</p>
<script>
document.getElementById('reveal-env').onclick = () => window.collectrx?.revealCollectrxEnv?.();
document.getElementById('open-folder').onclick = () => window.collectrx?.openUserDataFolder?.();
</script>
</body></html>`;
}

function buildEmbeddedSetupHtml() {
  const userData = app.getPath('userData');
  const envFile = path.join(userData, 'collectrx.env');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>CollectRx — Setup</title>
<style>body{font-family:system-ui;max-width:40rem;margin:2rem auto;padding:0 1rem;line-height:1.5}
button{margin:0.25rem 0.5rem 0.25rem 0;padding:0.45rem 0.85rem;font:inherit;cursor:pointer;border-radius:8px;border:1px solid #52525b;background:#3f3f46;color:#fafafa}
pre{background:#27272a;color:#fafafa;padding:1rem;border-radius:8px;overflow:auto;font-size:0.85rem}</style>
</head><body>
<h1>Built-in dashboard did not start</h1>
<p>Edit <strong>collectrx.env</strong> and set a real <code>DATABASE_URL</code> (PostgreSQL). Set <code>JWT_SECRET</code> to a long random string. Save, then quit and reopen CollectRx.</p>
<pre>${escHtml(envFile)}</pre>
<p>
<button type="button" id="reveal-env">Reveal collectrx.env</button>
<button type="button" id="open-folder">Open settings folder</button>
</p>
<p class="muted">Or use a hosted site only: add one <code>https://</code> line to <strong>dashboard-url.txt</strong> in this folder (see tray menu → Open settings folder).</p>
<p>If this keeps failing, launch CollectRx from Terminal to read <code>[backend]</code> logs.</p>
<script>
document.getElementById('reveal-env').onclick = () => window.collectrx?.revealCollectrxEnv?.();
document.getElementById('open-folder').onclick = () => window.collectrx?.openUserDataFolder?.();
</script>
</body></html>`;
}

async function resolvePackagedLoadTarget() {
  const remote = getRemoteDashboardUrl();
  if (remote) return { kind: 'url', url: remote };
  const port = await startEmbeddedBackend();
  if (port) return { kind: 'url', url: `http://127.0.0.1:${port}` };
  return { kind: 'setup', mode: 'embedded' };
}

// ── State ────────────────────────────────────────────────────────────────────
let mainWindow   = null;
let tray         = null;
let syncProcess  = null;
let syncStatus   = 'starting';
let syncLastMsg  = 'Starting…';
let lastSyncAt   = null;       // Date of last successful sync
let syncFailedSince    = null; // Date when error streak started
let failureAlertSent   = false;
let syncRetryDelay     = 30_000; // starts at 30s, doubles to max 5 min
app.isQuitting   = false;

// ── Update state ─────────────────────────────────────────────────────────────
let updateStatus    = 'idle';
let updateProgress  = 0;
let updateInfo      = null; // { version, changelog }

// ── IPC validation helpers ────────────────────────────────────────────────────
function assertString(val, maxLen = 500) {
  if (typeof val !== 'string') return '';
  return val.slice(0, maxLen).replace(/[<>"]/g, '');
}

function assertObject(val) {
  return val && typeof val === 'object' && !Array.isArray(val) ? val : {};
}

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
  starting: makeDotIcon('#F59E0B'),
  healthy:  makeDotIcon('#10B981'),
  error:    makeDotIcon('#EF4444'),
  update:   makeDotIcon('#6366F1'),
};

const TOOLTIPS = {
  starting: 'CollectRx — Starting sync…',
  healthy:  'CollectRx — Syncing ✓',
  error:    'CollectRx — Sync error',
  update:   'CollectRx — Update available',
};

// ── Tray menu ─────────────────────────────────────────────────────────────────
function buildTrayMenu() {
  const updateLabel = updateStatus === 'ready'
    ? `⬆  Install v${updateInfo?.version ?? '?'} & Restart`
    : updateStatus === 'downloading'
      ? `⬇  Downloading update (${updateProgress}%)…`
      : updateStatus === 'available'
        ? `⬇  Update v${updateInfo?.version ?? '?'} — downloading…`
        : '☁  Check for Updates';

  const syncLabel = syncStatus === 'healthy'
    ? `✓ Running${lastSyncAt ? '  ·  ' + lastSyncAt.toLocaleTimeString() : ''}`
    : syncStatus === 'error'
      ? '✗ Error — check logs'
      : 'Starting…';

  return Menu.buildFromTemplate([
    { label: `CollectRx v${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    { label: 'Open CollectRx',  click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    {
      label: updateLabel,
      click: () => {
        if (updateStatus === 'ready') {
          autoUpdater.quitAndInstall(false, true);
        } else if (updateStatus === 'idle' || updateStatus === 'error') {
          autoUpdater.checkForUpdates().catch(console.error);
        }
      },
    },
    { type: 'separator' },
    { label: `Sync: ${syncLabel}`, enabled: false },
    { label: 'Sync Now', click: () => triggerManualSync() },
    { type: 'separator' },
    { label: 'Settings…', click: () => { mainWindow?.show(); mainWindow?.webContents.send('navigate', '/settings'); } },
    {
      label: 'Open settings folder…',
      click: () => {
        ensureCollectrxEnvPlaceholder();
        openCollectrxUserDataFolder();
      },
    },
    { type: 'separator' },
    { label: 'Quit CollectRx', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
}

// ── Status management ─────────────────────────────────────────────────────────
function setStatus(status, message) {
  syncStatus  = status;
  syncLastMsg = message;

  if (status === 'healthy') {
    lastSyncAt          = new Date();
    syncFailedSince     = null;
    syncRetryDelay      = 30_000;   // reset backoff on success
    failureAlertSent    = false;
  } else if (status === 'error') {
    if (!syncFailedSince) syncFailedSince = new Date();

    // Fire desktop notification once after 30 minutes of continuous failure
    const failedMs = Date.now() - syncFailedSince.getTime();
    if (failedMs >= 30 * 60 * 1000 && !failureAlertSent) {
      failureAlertSent = true;
      if (Notification.isSupported()) {
        new Notification({
          title : 'CollectRx — Sync Problem',
          body  : 'AbelDent sync has been failing for 30+ minutes. Open CollectRx to check.',
          silent: false,
        }).show();
      }
    }
  }

  if (tray) {
    tray.setImage(ICONS[status] || ICONS.starting);
    tray.setToolTip(TOOLTIPS[status] || 'CollectRx');
    tray.setContextMenu(buildTrayMenu());
  }

  mainWindow?.webContents.send('sync-status-changed', {
    status,
    message : syncLastMsg,
    lastSyncAt: lastSyncAt?.toISOString() ?? null,
  });
}

// ── Tray ──────────────────────────────────────────────────────────────────────
function createTray() {
  tray = new Tray(ICONS.starting);
  tray.setToolTip(TOOLTIPS.starting);
  tray.setContextMenu(buildTrayMenu());
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

// ── BrowserWindow ─────────────────────────────────────────────────────────────
function createWindow(loadTarget) {
  mainWindow = new BrowserWindow({
    width    : 1280,
    height   : 820,
    minWidth : 960,
    minHeight: 600,
    title    : 'CollectRx',
    show     : false,
    webPreferences: {
      preload         : path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration : false,
      sandbox         : true,
      webSecurity     : true,
    },
  });

  if (loadTarget.kind === 'setup') {
    const html =
      loadTarget.mode === 'remote' ? buildRemoteSetupHtml() : buildEmbeddedSetupHtml();
    mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  } else {
    mainWindow.loadURL(loadTarget.url);
  }

  mainWindow.once('ready-to-show', () => {
    // --hidden = Windows startup shortcut; stay minimized in tray
    if (!process.argv.includes('--hidden')) {
      mainWindow.show();
    }
  });

  // Minimize to tray on close
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // External links → OS browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error(`[Window] Failed to load: ${code} ${desc}`);
    if (isDev) {
      setTimeout(() => mainWindow?.loadURL(DASHBOARD_URL_DEV), 2_000);
    }
  });
}

// ── Windows startup auto-launch ───────────────────────────────────────────────
function setupStartupLaunch() {
  if (!app.isPackaged) return; // dev mode: don't register
  app.setLoginItemSettings({
    openAtLogin: true,
    args       : ['--hidden'],  // start minimized to tray
  });
}

// ── Changelog fetch ───────────────────────────────────────────────────────────
function fetchChangelog(version) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path    : `/repos/khalidegeh/Click/releases/tags/v${version}`,
      headers : { 'User-Agent': 'CollectRx-Desktop' },
    };
    const req = https.get(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const body = JSON.parse(data).body || '';
          // Trim to first 600 chars so the dialog stays readable
          resolve(body.slice(0, 600) || 'See GitHub Releases for full changelog.');
        } catch {
          resolve('See GitHub Releases for full changelog.');
        }
      });
    });
    req.on('error', () => resolve('See GitHub Releases for full changelog.'));
    req.setTimeout(5_000, () => { req.destroy(); resolve('See GitHub Releases for full changelog.'); });
  });
}

// ── Auto-updater ──────────────────────────────────────────────────────────────
function setupAutoUpdater() {
  if (isDev) {
    console.log('[Updater] Skipped in dev mode');
    return;
  }

  autoUpdater.autoDownload         = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Checking…');
    updateStatus = 'checking';
    tray?.setContextMenu(buildTrayMenu());
  });

  autoUpdater.on('update-available', async (info) => {
    console.log(`[Updater] v${info.version} available`);
    updateStatus = 'available';
    const changelog = await fetchChangelog(info.version);
    updateInfo = { version: info.version, changelog };
    tray?.setImage(ICONS.update);
    tray?.setContextMenu(buildTrayMenu());
    mainWindow?.webContents.send('update-available', { version: info.version, changelog });
  });

  autoUpdater.on('update-not-available', () => {
    updateStatus = 'idle';
    tray?.setContextMenu(buildTrayMenu());
  });

  autoUpdater.on('download-progress', (p) => {
    updateStatus   = 'downloading';
    updateProgress = Math.round(p.percent);
    console.log(`[Updater] ${updateProgress}% @ ${Math.round(p.bytesPerSecond / 1024)} KB/s`);
    tray?.setContextMenu(buildTrayMenu());
    mainWindow?.webContents.send('update-progress', { percent: updateProgress });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[Updater] v${info.version} ready`);
    updateStatus = 'ready';
    tray?.setImage(ICONS.update);
    tray?.setContextMenu(buildTrayMenu());

    const changelog = updateInfo?.changelog || 'See GitHub Releases for details.';

    dialog.showMessageBox(mainWindow, {
      type     : 'info',
      title    : `CollectRx v${info.version} Ready`,
      message  : `CollectRx v${info.version} has been downloaded and is ready to install.`,
      detail   : `What's new:\n\n${changelog}\n\nRestart now to apply, or it will install automatically on next quit.`,
      buttons  : ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId : 1,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall(false, true);
    }).catch(console.error);

    mainWindow?.webContents.send('update-ready', { version: info.version, changelog });
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err.message);
    updateStatus = 'error';
    tray?.setContextMenu(buildTrayMenu());
  });

  // Check 10s after launch, then every 4 hours
  setTimeout(() => autoUpdater.checkForUpdates().catch(console.error), 10_000);
  setInterval(() => autoUpdater.checkForUpdates().catch(console.error), 4 * 60 * 60 * 1000);
}

// ── Sync service ──────────────────────────────────────────────────────────────
function spawnSyncService() {
  if (!fs.existsSync(SYNC_SERVICE_PATH)) {
    console.log('[Sync] Service not found at', SYNC_SERVICE_PATH, '— skipping');
    setStatus('starting', 'Sync service not configured');
    return;
  }

  const config = readConfig();

  console.log('[Sync] Spawning', SYNC_SERVICE_PATH, `(retry delay ${syncRetryDelay / 1000}s)`);
  setStatus('starting', 'Sync service starting…');

  syncProcess = spawn(process.execPath, [SYNC_SERVICE_PATH], {
    env: {
      ...process.env,
      // Forward AbelDent config from userData/config.json
      ABELDENT_SERVER          : config.abeldentServer   || process.env.ABELDENT_SERVER   || '',
      ABELDENT_DATABASE        : config.abeldentDatabase || process.env.ABELDENT_DATABASE || 'AbelDent',
      ABELDENT_PRACTICE_ID     : config.practiceId       || process.env.ABELDENT_PRACTICE_ID || '',
      RAILWAY_API_URL          : config.railwayUrl       || process.env.RAILWAY_API_URL   || '',
      RAILWAY_API_TOKEN        : config.railwayToken     || process.env.RAILWAY_API_TOKEN || '',
      SYNC_INTERVAL_MINUTES    : String(config.syncIntervalMinutes || 15),
    },
    stdio      : ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  syncProcess.stdout.on('data', (chunk) => {
    const line = chunk.toString().trim();
    console.log('[Sync]', line);
    if (line.includes('SYNC_OK'))    setStatus('healthy', line);
    if (line.includes('SYNC_ERROR')) setStatus('error',   line);
  });

  syncProcess.stderr.on('data', (chunk) => {
    const line = chunk.toString().trim();
    console.error('[Sync err]', line);
    if (line.toLowerCase().includes('error')) setStatus('error', line.slice(0, 140));
  });

  syncProcess.on('exit', (code) => {
    syncProcess = null;
    if (!app.isQuitting) {
      setStatus('error', `Sync stopped (code ${code}). Restarting in ${syncRetryDelay / 1000}s…`);
      setTimeout(spawnSyncService, syncRetryDelay);
      // Exponential backoff: 30s → 60s → 120s → 240s → 300s (cap)
      syncRetryDelay = Math.min(syncRetryDelay * 2, 5 * 60 * 1000);
    }
  });
}

function triggerManualSync() {
  if (syncProcess && !syncProcess.killed) {
    syncProcess.stdin?.write('SYNC_NOW\n');
  }
}

function restartSyncService() {
  if (syncProcess && !syncProcess.killed) {
    syncProcess.kill('SIGTERM');
  } else {
    syncRetryDelay = 30_000; // reset before manual restart
    spawnSyncService();
  }
}

// ── IPC ───────────────────────────────────────────────────────────────────────
ipcMain.handle('get-sync-status', () => ({
  status    : syncStatus,
  message   : syncLastMsg,
  lastSyncAt: lastSyncAt?.toISOString() ?? null,
}));

ipcMain.handle('trigger-manual-sync', () => { triggerManualSync(); return true; });

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('get-update-status', () => ({
  status  : updateStatus,
  progress: updateProgress,
  info    : updateInfo,
}));

ipcMain.handle('install-update', () => {
  if (updateStatus === 'ready') autoUpdater.quitAndInstall(false, true);
  return { ok: true };
});

// Settings IPC — read/write AbelDent connection config
ipcMain.handle('get-settings', () => readConfig());

ipcMain.handle('save-settings', (_event, rawSettings) => {
  const settings = assertObject(rawSettings);
  // Validate and sanitize each field
  const safe = {
    abeldentServer       : assertString(settings.abeldentServer, 200),
    abeldentDatabase     : assertString(settings.abeldentDatabase, 100),
    practiceId           : assertString(settings.practiceId, 100),
    railwayUrl           : assertString(settings.railwayUrl, 300),
    railwayToken         : assertString(settings.railwayToken, 500),
    syncIntervalMinutes  : Math.max(5, Math.min(60, parseInt(settings.syncIntervalMinutes) || 15)),
  };
  const result = writeConfig(safe);
  if (result) {
    // Restart sync service with new config
    restartSyncService();
  }
  return { ok: !!result };
});

ipcMain.handle('open-user-data-folder', async () => {
  ensureCollectrxEnvPlaceholder();
  const err = await shell.openPath(app.getPath('userData'));
  return { ok: !err, error: err || null };
});

ipcMain.handle('reveal-collectrx-env', async () => {
  revealCollectrxEnvInShell();
  return { ok: true };
});

// ── Lifecycle ─────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  ensureCollectrxEnvPlaceholder();
  setupStartupLaunch();
  createTray();
  let loadTarget;
  if (isDev) {
    loadTarget = { kind: 'url', url: DASHBOARD_URL_DEV };
  } else {
    loadTarget = await resolvePackagedLoadTarget();
  }
  createWindow(loadTarget);
  spawnSyncService();
  setupAutoUpdater();
});

app.on('second-instance', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});

app.on('window-all-closed', (e) => e.preventDefault()); // stay alive in tray

app.on('before-quit', () => {
  app.isQuitting = true;
  syncProcess?.kill('SIGTERM');
  if (backendChild && !backendChild.killed) {
    try {
      backendChild.kill('SIGTERM');
    } catch (_) { /* */ }
    backendChild = null;
  }
});
