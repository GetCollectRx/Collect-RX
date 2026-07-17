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
  /** API base for /api in the renderer (COLLECTRX_API_ORIGIN or api-origin.txt). */
  apiOrigin,
  getSyncStatus    : () => ipcRenderer.invoke('get-sync-status'),
  onSyncStatusChange: (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on('sync-status-changed', fn);
    return () => ipcRenderer.removeListener('sync-status-changed', fn);
  },
  triggerManualSync: () => ipcRenderer.invoke('trigger-manual-sync'),
  getAppVersion    : () => ipcRenderer.invoke('get-app-version'),
  onUpdateAvailable: (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on('update-available', fn);
    return () => ipcRenderer.removeListener('update-available', fn);
  },
  onUpdateDownloaded: (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on('update-downloaded', fn);
    return () => ipcRenderer.removeListener('update-downloaded', fn);
  },
  restartToUpdate  : () => ipcRenderer.invoke('restart-to-update'),
  retryDashboardLoad: () => ipcRenderer.invoke('retry-dashboard-load'),
});
