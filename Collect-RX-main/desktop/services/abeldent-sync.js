/**
 * AbelDent Sync Service — Electron Utility Process
 *
 * Runs inside Electron via utilityProcess.fork().
 * Queries the on-premise AbelDent SQL Server database (Windows Integrated Auth)
 * and POSTs outstanding claims to the Railway backend for queue processing.
 *
 * IPC (via process.parentPort):
 *   Receives: { type: 'trigger' }   — run a sync immediately
 *   Sends:    { type: 'status', status: 'syncing'|'ok'|'error', message?, lastSync? }
 *
 * Required env vars:
 *   ABELDENT_SERVER          SQL Server instance, e.g. "(local)\ABELDENT" or "192.168.1.10"
 *   ABELDENT_DATABASE        Database name, default "AbelDent"
 *   RAILWAY_API_URL          CollectRx backend root
 *   RAILWAY_API_TOKEN        Long-lived JWT for the service account
 *
 * Optional:
 *   ABELDENT_SCHEMA_MAP      Path to schema-map.json (see schema-map.example.json + discover-schema.cjs)
 *   ABELDENT_PATIENT_LEDGER_TABLE  Override patient ledger table name only
 */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const {
  mergeMap,
  buildClaimsQuery,
  buildPatientBalanceQuery,
} = require('./abeldentQueryTemplates.cjs');

// Config
const SERVER = process.env.ABELDENT_SERVER || String.raw`(local)\ABELDENT`;
const DATABASE = process.env.ABELDENT_DATABASE || 'AbelDent';
const RAILWAY_URL = (process.env.RAILWAY_API_URL || '').replace(/\/$/, '');
const API_TOKEN = process.env.RAILWAY_API_TOKEN || '';
const PRACTICE_ID = process.env.ABELDENT_PRACTICE_ID || null;
const INTERVAL_MS = (parseInt(process.env.SYNC_INTERVAL_MINUTES, 10) || 15) * 60_000;
const MIN_DAYS = parseInt(process.env.ABELDENT_MIN_DAYS, 10) || 14;
const MIN_DAYS_BALANCE = parseInt(process.env.ABELDENT_MIN_DAYS_BALANCE, 10) || 7;

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
if (process.env.ABELDENT_PATIENT_LEDGER_TABLE) {
  _schemaMap.patientLedger.table = process.env.ABELDENT_PATIENT_LEDGER_TABLE.replace(/[^A-Za-z0-9_]/g, '');
}

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

// Post to Railway
function postToRailway(payload, endpoint) {
  return new Promise((resolve, reject) => {
    if (!RAILWAY_URL || !API_TOKEN) {
      return reject(new Error('RAILWAY_API_URL or RAILWAY_API_TOKEN is not set'));
    }

    const url = `${RAILWAY_URL}${endpoint}${PRACTICE_ID ? `?practice_id=${PRACTICE_ID}` : ''}`;
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

const PATIENT_BALANCE_SQL = buildPatientBalanceQuery(_schemaMap);

async function fetchPatientBalances() {
  if (!sql) throw new Error('mssql not available');
  const pool = await sql.connect(sqlConfig);
  const request = pool.request();
  request.input('minDaysBalance', sql.Int, MIN_DAYS_BALANCE);
  const result = await request.query(PATIENT_BALANCE_SQL);
  await pool.close();
  return result.recordset;
}

// Sync cycles
async function runClaimsSync() {
  sendStatus('syncing');
  try {
    const rows = await fetchFromAbeldent();
    const result = await postToRailway(
      { records: rows, pmsVendor: 'abeldent', pmsSource: 'abeldent' },
      '/api/insurance/claims/import',
    );
    try {
      await postToRailway({}, '/api/work-queue/sync');
    } catch (syncErr) {
      console.warn('[Sync] Work queue refresh failed:', syncErr.message);
    }
    sendStatus('ok', `Synced ${result.imported ?? rows.length} claims`);
    return true;
  } catch (err) {
    sendStatus('error', err.message);
    return false;
  }
}

async function runPatientBalanceSync() {
  try {
    const rows = await fetchPatientBalances();
    const result = await postToRailway(rows, '/api/patients/balances');
    sendStatus('ok', `Patient balances: ${result.imported ?? 0} new, ${result.updated ?? 0} updated`);
    return true;
  } catch (err) {
    sendStatus('error', `Patient balance sync failed: ${err.message}`);
    return false;
  }
}

async function runAllSyncs() {
  if (!sql) {
    sendStatus('offline', 'mssql driver not available');
    return;
  }
  await runClaimsSync();
  await runPatientBalanceSync();
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
runAllSyncs();
setInterval(runAllSyncs, INTERVAL_MS);
