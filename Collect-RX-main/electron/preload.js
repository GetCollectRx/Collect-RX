'use strict';

const { contextBridge, ipcRenderer } = require('electron');

let apiOrigin;
try {
  const v = ipcRenderer.sendSync('crx-get-api-origin');
  apiOrigin = typeof v === 'string' && v.trim() ? v.trim().replace(/\/$/, '') : undefined;
} catch {
  apiOrigin = undefined;
}

contextBridge.exposeInMainWorld('collectrx', {
  /** API base for /api in the renderer (COLLECTRX_API_ORIGIN or api-origin.txt). Loopback is ignored when the window loads a remote https dashboard — see electron/main.js. */
  apiOrigin,
  getSyncStatus    : () => ipcRenderer.invoke('get-sync-status'),
  onSyncStatusChange: (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on('sync-status-changed', fn);
    return () => ipcRenderer.removeListener('sync-status-changed', fn);
  },
  triggerManualSync: () => ipcRenderer.invoke('trigger-manual-sync'),
  getAppVersion    : () => ipcRenderer.invoke('get-app-version'),
});
