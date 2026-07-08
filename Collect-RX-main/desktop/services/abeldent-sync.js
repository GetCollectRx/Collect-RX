/**
 * AbelDent Sync Service — Electron Utility Process
 *
 * Runs inside Electron via utilityProcess.fork().
 * Queries the on-premise AbelDent SQL Server database (Windows Integrated Auth)
 * and POSTs outstanding claims to the CollectRx API for queue processing.
 *
 * IPC (via process.parentPort):
 *   Receives: { type: 'trigger' }   — run a sync immediately
 *   Sends:    { type: 'status', status: 'syncing'|'ok'|'error', message?, lastSync? }
 *
 * Required env vars:
 *   ABELDENT_SERVER          SQL Server instance, e.g. "(local)\ABELDENT" or "192.168.1.10"
 *   ABELDENT_DATABASE        Database name, default "AbelDent"
 *   COLLECTRX_API_URL        CollectRx API root (preferred)
 *   COLLECTRX_API_TOKEN      Long-lived connector token (minted in Admin → Sync ops)
 *   COLLECTRX_CONNECTOR_TOKEN Alias for COLLECTRX_API_TOKEN
 *   RAILWAY_API_URL          Legacy alias for COLLECTRX_API_URL
 *   RAILWAY_API_TOKEN        Legacy alias for COLLECTRX_API_TOKEN
 *
 * Optional:
 *   ABELDENT_SCHEMA_MAP      Path to schema-map.json (see schema-map.example.json + discover-schema.cjs)
 */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const {
  mergeMap,
  buildClaimsQuery,
} = require('./abeldentQueryTemplates.cjs');

// Config
const SERVER = process.env.ABELDENT_SERVER || String.raw`(local)\ABELDENT`;
const DATABASE = process.env.ABELDENT_DATABASE || 'AbelDent';
const API_URL = (process.env.COLLECTRX_API_URL || process.env.RAILWAY_API_URL || '').replace(/\/$/, '');
const API_TOKEN = process.env.COLLECTRX_API_TOKEN
  || process.env.COLLECTRX_CONNECTOR_TOKEN
  || process.env.RAILWAY_API_TOKEN
  || '';
const AGENT_VERSION = process.env.COLLECTRX_AGENT_VERSION || '1.0.0';
const HEARTBEAT_MS = (parseInt(process.env.HEARTBEAT_INTERVAL_MINUTES, 10) || 5) * 60_000;
const PRACTICE_ID = process.env.ABELDENT_PRACTICE_ID || null;
const INTERVAL_MS = (parseInt(process.env.SYNC_INTERVAL_MINUTES, 10) || 15) * 60_000;
const MIN_DAYS = parseInt(process.env.ABELDENT_MIN_DAYS, 10) || 14;

/** Schema map path (JSON) — from `scripts/sync-query-builder.cjs` + discover-schema; optional. */
function loadSchemaMapOverrides() {
  const mapPath = process.env.ABELDENT_SCHEMA_MAP || process.env.SCHEMA_MAP_PATH;
  if (!mapPath) return {};
  const resolved = path.isAbsolute(mapPath) ? mapPath : path.join(process.cwd(), mapPath);
  const raw = fs.readFileSync(resolved, 'utf8');
  const parsed = JSON.parse(raw);
  return parsed.mappings || parsed;
}

const _schemaMap = mergeMap(loadSchemaMapOverrides());

const CLAIMS_SYNC_SQL = buildClaimsQuery(_schemaMap);

// IPC helpers
// Supports two transports:
//   1. utilityProcess.fork() — uses process.parentPort (recommended for Electron)
//   2. child_process.spawn() — uses stdin/stdout protocol (main.js current impl)
//      stdout keywords: "SYNC_OK: ..." and "SYNC_ERROR: ..."
//      stdin keyword:   "SYNC_NOW"

function send(type, payload = {}) {
  if (process.parentPort) {
    process.parentPort.postMessage({ type, ...payload });
  }
}

function sendStatus(status, message) {
  const msg = message || null;
  const lastSync = new Date().toISOString();

  // Transport 1: utilityProcess parentPort
  send('status', { status, message: msg, lastSync });

  // Transport 2: stdout lines for child_process.spawn() in electron/main.js
  if (status === 'ok' || status === 'syncing') {
    process.stdout.write(`SYNC_OK: ${msg || lastSync}\n`);
  } else if (status === 'error') {
    process.stdout.write(`SYNC_ERROR: ${msg || 'unknown error'}\n`);
  }
}

// Check if mssql is available
let sql = null;
try {
  sql = require('mssql');
} catch {
  console.log('[Sync] mssql package not installed — sync disabled');
}

const sqlConfig = sql ? {
  server: SERVER,
  database: DATABASE,
  driver: 'msnodesqlv8',
  options: {
    trustedConnection: true,
    enableArithAbort: true,
    trustServerCertificate: true,
  },
} : null;

async function fetchFromAbeldent() {
  if (!sql) throw new Error('mssql not available');
  const pool = await sql.connect(sqlConfig);
  const request = pool.request();
  request.input('minDays', sql.Int, MIN_DAYS);
  const result = await request.query(CLAIMS_SYNC_SQL);
  await pool.close();
  return result.recordset;
}

// Post to CollectRx API (connector token auth — practice is bound to the token)
function postToApi(payload, endpoint) {
  return new Promise((resolve, reject) => {
    if (!API_URL || !API_TOKEN) {
      return reject(new Error('COLLECTRX_API_URL and COLLECTRX_API_TOKEN (connector token) must be set'));
    }

    const url = `${API_URL}${endpoint}`;
    const parsed = new URL(url);
    const body = Buffer.from(JSON.stringify(payload));

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length,
        'Authorization': `Bearer ${API_TOKEN}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject(new Error(`API ${res.statusCode}: ${json.error || data}`));
          }
        } catch {
          reject(new Error(`API parse error (HTTP ${res.statusCode})`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendHeartbeat(extra = {}) {
  if (!API_URL || !API_TOKEN) return;
  try {
    await postToApi(
      {
        version: AGENT_VERSION,
        hostname: require('os').hostname(),
        platform: process.platform,
        ...extra,
      },
      '/api/connector/heartbeat',
    );
  } catch (err) {
    console.warn('[Sync] Heartbeat failed:', err.message);
  }
}

// Sync cycles
async function runClaimsSync() {
  sendStatus('syncing');
  try {
    const rows = await fetchFromAbeldent();
    const result = await postToApi(
      { records: rows, pmsVendor: 'abeldent', pmsSource: 'abeldent' },
      '/api/connector/claims/import',
    );
    sendStatus('ok', `Synced ${result.imported ?? rows.length} claims`);
    await sendHeartbeat({ status: 'ok', message: `Synced ${result.imported ?? rows.length} claims`, imported: result.imported ?? rows.length });
    return true;
  } catch (err) {
    sendStatus('error', err.message);
    await sendHeartbeat({ status: 'error', message: err.message });
    return false;
  }
}

async function runAllSyncs() {
  if (!sql) {
    sendStatus('offline', 'mssql driver not available');
    return;
  }
  await runClaimsSync();
}

// Listen for manual trigger
// Transport 1: utilityProcess parentPort
if (process.parentPort) {
  process.parentPort.on('message', (msg) => {
    if (msg?.data?.type === 'trigger') {
      runAllSyncs().catch(() => {});
    }
  });
}

// Transport 2: stdin "SYNC_NOW" line (used by child_process.spawn() in electron/main.js)
if (process.stdin && !process.stdin.destroyed) {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    if (chunk.toString().trim() === 'SYNC_NOW') {
      console.log('[Sync] Manual trigger received via stdin');
      runAllSyncs().catch(() => {});
    }
  });
}

// Initial sync on start, then on interval
sendHeartbeat({ status: 'starting' }).finally(() => runAllSyncs());
setInterval(runAllSyncs, INTERVAL_MS);
setInterval(() => { void sendHeartbeat(); }, HEARTBEAT_MS);
