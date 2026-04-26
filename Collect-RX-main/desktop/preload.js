/**
 * CollectRx Desktop — Preload Script
 *
 * Runs in a privileged context before the renderer (web page) loads.
 * Exposes only what the frontend explicitly needs from Node/Electron.
 *
 * contextIsolation: true ensures the renderer cannot access Node APIs directly.
 *
 * API shape (available as window.collectrx):
 *   .version          — app version string
 *   .platform         — 'win32' | 'darwin' | 'linux'
 *   .isElectron       — true (lets the frontend detect it's running in Electron)
 *   .sync.onUpdate    — subscribe to sync status updates from main process
 *   .sync.trigger     — manually trigger an AbelDent sync
 *   .priority.set     — set today's carrier priority (relayed to Railway by main process)
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('collectrx', {
  version: process.env.npm_package_version || '1.0.0',
  platform: process.platform,
  isElectron: true,

  sync: {
    /**
     * Subscribe to sync status updates pushed by the main process.
     * callback({ status: 'syncing'|'ok'|'error'|'offline', message: string|null })
     * Returns a cleanup function — call it to unsubscribe.
     */
    onUpdate: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('sync-status', handler);
      return () => ipcRenderer.removeListener('sync-status', handler);
    },

    /**
     * Tell the main process to run an AbelDent sync immediately.
     * Returns a promise resolving to { ok: boolean, error?: string }.
     */
    trigger: () => ipcRenderer.invoke('trigger-sync'),

    /**
     * Get current sync status.
     */
    getStatus: () => ipcRenderer.invoke('get-sync-status'),
  },

  priority: {
    /**
     * Set today's carrier focus priority.
     * The main process reads the JWT from the call args and forwards to Railway.
     *
     * carrier  — one of: 'sun_life' | 'canada_life' | 'manulife' |
     *                     'green_shield' | 'rbc_insurance' | 'telus_adjudicare'
     * date     — ISO date string (YYYY-MM-DD), defaults to today if omitted
     *
     * Returns a promise resolving to { ok: boolean, error?: string }.
     */
    set: (carrier, date) => {
      // Read the JWT from the page's localStorage
      const token = localStorage.getItem('crx_token');
      return ipcRenderer.invoke('set-carrier-priority', { carrier, date, token });
    },
  },
});
