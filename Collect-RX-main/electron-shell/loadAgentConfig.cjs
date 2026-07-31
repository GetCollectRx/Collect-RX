'use strict';

/**
 * Load practice desktop agent config from JSON (no hand-editing env vars required).
 *
 * Search order (first file wins):
 *   1. %ProgramData%\CollectRx\agent-config.json (Windows, packaged)
 *   2. ~/Library/Application Support/CollectRx/agent-config.json (macOS)
 *   3. ~/.config/collectrx/agent-config.json (Linux)
 *   4. COLLECTRX_AGENT_CONFIG env path
 *   5. ./agent-config.json next to the app (dev)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function programDataDir() {
  if (process.platform === 'win32') {
    return process.env.ProgramData
      ? path.join(process.env.ProgramData, 'CollectRx')
      : path.join('C:\\ProgramData', 'CollectRx');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'CollectRx');
  }
  return path.join(os.homedir(), '.config', 'collectrx');
}

function candidatePaths(appRoot) {
  const out = [];
  const envPath = process.env.COLLECTRX_AGENT_CONFIG?.trim();
  if (envPath) out.push(envPath);
  out.push(path.join(programDataDir(), 'agent-config.json'));
  if (appRoot) out.push(path.join(appRoot, 'agent-config.json'));
  out.push(path.join(process.cwd(), 'agent-config.json'));
  return out;
}

function readJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    /* missing or invalid */
  }
  return null;
}

/**
 * @param {string} [appRoot] electron app.getAppPath() or resources path
 * @returns {Record<string, string>}
 */
function loadAgentConfig(appRoot) {
  for (const p of candidatePaths(appRoot)) {
    const data = readJsonFile(p);
    if (data) {
      console.log(`[agent-config] Loaded ${p}`);
      return data;
    }
  }
  return {};
}

/**
 * Apply config keys to process.env when not already set.
 * @param {Record<string, unknown>} config
 */
function applyAgentConfigToEnv(config) {
  const map = {
    apiUrl: 'COLLECTRX_API_URL',
    apiToken: 'COLLECTRX_API_TOKEN',
    connectorToken: 'COLLECTRX_CONNECTOR_TOKEN',
    abeldentServer: 'ABELDENT_SERVER',
    abeldentDatabase: 'ABELDENT_DATABASE',
    practiceId: 'ABELDENT_PRACTICE_ID',
    schemaMap: 'ABELDENT_SCHEMA_MAP',
    syncIntervalMinutes: 'SYNC_INTERVAL_MINUTES',
    dashboardUrl: 'COLLECTRX_DASHBOARD_URL',
  };
  for (const [key, envName] of Object.entries(map)) {
    if (config[key] != null && !process.env[envName]) {
      process.env[envName] = String(config[key]).trim();
    }
  }
  if (!process.env.COLLECTRX_API_TOKEN && config.connectorToken) {
    process.env.COLLECTRX_API_TOKEN = String(config.connectorToken).trim();
  }
}

module.exports = { loadAgentConfig, applyAgentConfigToEnv, programDataDir, candidatePaths };
