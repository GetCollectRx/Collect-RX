'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('collectrx', {
  getSyncStatus    : () => ipcRenderer.invoke('get-sync-status'),
  onSyncStatusChange: (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on('sync-status-changed', fn);
    return () => ipcRenderer.removeListener('sync-status-changed', fn);
  },
  triggerManualSync: () => ipcRenderer.invoke('trigger-manual-sync'),
  getAppVersion    : () => ipcRenderer.invoke('get-app-version'),
});
