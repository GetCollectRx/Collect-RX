'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('collectrx', {
  // ── Sync ────────────────────────────────────────────────────────────────────
  getSyncStatus    : () => ipcRenderer.invoke('get-sync-status'),
  onSyncStatusChange: (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on('sync-status-changed', fn);
    return () => ipcRenderer.removeListener('sync-status-changed', fn);
  },
  triggerManualSync: () => ipcRenderer.invoke('trigger-manual-sync'),

  // ── App ─────────────────────────────────────────────────────────────────────
  getAppVersion    : () => ipcRenderer.invoke('get-app-version'),

  // ── Auto-updater ─────────────────────────────────────────────────────────────
  getUpdateStatus  : () => ipcRenderer.invoke('get-update-status'),
  installUpdate    : () => ipcRenderer.invoke('install-update'),
  onUpdateAvailable: (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on('update-available', fn);
    return () => ipcRenderer.removeListener('update-available', fn);
  },
  onUpdateProgress : (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on('update-progress', fn);
    return () => ipcRenderer.removeListener('update-progress', fn);
  },
  onUpdateReady    : (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on('update-ready', fn);
    return () => ipcRenderer.removeListener('update-ready', fn);
  },

  // ── Settings (AbelDent config) ────────────────────────────────────────────
  getSettings  : () => ipcRenderer.invoke('get-settings'),
  saveSettings : (settings) => ipcRenderer.invoke('save-settings', settings),

  // ── Navigation (tray → renderer) ─────────────────────────────────────────
  onNavigate: (cb) => {
    const fn = (_e, route) => cb(route);
    ipcRenderer.on('navigate', fn);
    return () => ipcRenderer.removeListener('navigate', fn);
  },
});
