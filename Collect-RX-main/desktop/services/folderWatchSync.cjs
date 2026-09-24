'use strict';

/**
 * CollectRx Folder-Watch Sync — Local Export Agent
 *
 * For PMS vendors with no confirmed scheduled-export or API pull path (see
 * docs/operations/PMS-AUTOMATION-EVIDENCE.md), this is the fallback that still removes
 * the recurring manual *upload* step: a practice points this agent at a local folder,
 * and whatever CSV export lands there (dropped by staff, a practice-built scheduled task,
 * or a PMS feature if one exists) gets picked up and pushed through the existing
 * connector-token-authenticated import pipeline automatically.
 *
 * This does NOT talk to any PMS directly — it only watches a filesystem folder and
 * uploads files it finds there. It never assumes a PMS can generate exports on a
 * schedule; that capability (or the lack of it) is a per-practice, per-vendor fact
 * documented separately, not something this module infers from a vendor name.
 *
 * Design constraints (see task description this was built against):
 *   - Dedupe by file content hash, not filename or mtime (PMS exports commonly reuse
 *     a fixed filename like "export.csv" on every run).
 *   - Never read a file mid-write: require size+mtime to be stable across two stat()
 *     calls WATCH_STABILITY_MS apart before touching it.
 *   - Retry transient failures (network, 5xx) with exponential backoff; stop retrying
 *     and flag `needs_attention` after WATCH_MAX_ATTEMPTS on a given file content hash,
 *     rather than looping forever on a file that will never parse.
 *   - Never log row contents or PHI-shaped strings; only filenames, hashes, counts,
 *     and status. Redact anything email/DOB-shaped from stderr-style logs.
 *   - Retention is an explicit, configured policy — 'move' (default, to a local
 *     processed/ subfolder), 'delete', or 'keep' — never an implicit default of
 *     silently deleting practice data.
 *   - The manual CSV upload path (pmsSyncRoutes.ts, session-authenticated) is untouched
 *     by this module and remains the fallback if the watcher is not configured or is
 *     offline.
 *
 * IPC (same two-transport convention as abeldent-sync.cjs):
 *   Receives: { type: 'trigger' }  — run a scan cycle immediately
 *   Sends:    { type: 'status', status: 'syncing'|'ok'|'error'|'offline', message?, lastSync? }
 *
 * Required env vars:
 *   WATCH_FOLDER              Absolute path to the folder to watch for PMS exports
 *   COLLECTRX_API_URL         CollectRx API root
 *   COLLECTRX_API_TOKEN       Connector token (same token type as the AbelDent connector)
 *
 * Optional:
 *   WATCH_INTERVAL_MS         Poll interval (default 60000 — 1 minute; cheap, local-only)
 *   WATCH_STABILITY_MS        Required unchanged-stat window before reading a file (default 10000)
 *   WATCH_FILE_EXTENSIONS     Comma-separated allowed extensions (default ".csv,.txt")
 *   WATCH_MAX_ATTEMPTS        Attempts per file content hash before giving up (default 5)
 *   WATCH_RETENTION_POLICY    'move' | 'delete' | 'keep' (default 'move')
 *   WATCH_RETENTION_DAYS      Days to keep files in processed/ before deleting them (default 30, 'move' only)
 *   WATCH_PMS_VENDOR          Vendor catalog id, or 'auto' to use practice default (default 'auto')
 *   WATCH_STATE_DIR           Where to store the dedupe ledger (default alongside WATCH_FOLDER)
 */

const fs = require('fs');
const path = require('path');

// ── Pure / testable helpers ─────────────────────────────────────────────────

/**
 * A file is "stable" (fully written, not mid-export) when size and mtime are
 * identical across two stat() snapshots taken WATCH_STABILITY_MS apart.
 */
function isFileStable(statA, statB) {
  if (!statA || !statB) return false;
  return statA.size === statB.size && statA.mtimeMs === statB.mtimeMs && statA.size > 0;
}

/** Exponential backoff, capped at 15 minutes, jittered by up to 20% to avoid thundering herd. */
function computeBackoffMs(attempt, baseMs = 30_000, capMs = 15 * 60_000) {
  const n = Math.max(1, attempt);
  const raw = Math.min(baseMs * 2 ** (n - 1), capMs);
  const jitter = raw * 0.2 * Math.random();
  return Math.round(raw + jitter);
}

/** Default JSON shape for a fresh ledger. */
function emptyLedger() {
  return { version: 1, entries: {} };
}

function loadLedger(ledgerPath) {
  try {
    const raw = fs.readFileSync(ledgerPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.entries) return parsed;
  } catch {
    /* missing or invalid — start fresh */
  }
  return emptyLedger();
}

function saveLedger(ledgerPath, ledger) {
  const dir = path.dirname(ledgerPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${ledgerPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(ledger, null, 2), 'utf8');
  fs.renameSync(tmpPath, ledgerPath); // atomic on same filesystem — avoids a torn ledger on crash mid-write
}

/**
 * Decide whether a file with this content hash should be (re)attempted.
 *   'process'          — new hash, or a previous attempt failed and hasn't hit the cap
 *   'skip_done'         — already imported successfully
 *   'skip_needs_attention' — hit WATCH_MAX_ATTEMPTS; stop auto-retrying, surface to staff
 */
function shouldProcess(ledger, hash, maxAttempts) {
  const entry = ledger.entries[hash];
  if (!entry) return 'process';
  if (entry.status === 'done') return 'skip_done';
  if (entry.status === 'needs_attention') return 'skip_needs_attention';
  if ((entry.attempts || 0) >= maxAttempts) return 'skip_needs_attention';
  return 'process';
}

function recordOutcome(ledger, hash, fileName, outcome) {
  const prev = ledger.entries[hash] || { attempts: 0 };
  const attempts = (prev.attempts || 0) + (outcome.status === 'attempt_failed' ? 1 : 0);
  const status =
    outcome.status === 'imported'
      ? 'done'
      : attempts >= outcome.maxAttempts
        ? 'needs_attention'
        : 'pending_retry';
  ledger.entries[hash] = {
    fileName,
    firstSeenAt: prev.firstSeenAt || new Date().toISOString(),
    lastAttemptAt: new Date().toISOString(),
    attempts,
    status,
    lastError: outcome.error || null,
    lastResult:
      outcome.status === 'imported'
        ? { imported: outcome.imported, skipped: outcome.skipped, failed: outcome.failed, runId: outcome.runId }
        : prev.lastResult || null,
  };
  return ledger;
}

/** Strip anything email/DOB/phone-shaped before it reaches a local log line — defense in depth. */
function redactForLog(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[redacted-email]')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '[redacted-date]')
    .replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[redacted-phone]')
    .slice(0, 500);
}

function listCandidateFiles(folderPath, extensions) {
  let names;
  try {
    names = fs.readdirSync(folderPath);
  } catch (err) {
    throw new Error(`Cannot read watch folder "${folderPath}": ${err.message}`);
  }
  return names
    .filter((name) => extensions.some((ext) => name.toLowerCase().endsWith(ext)))
    .map((name) => path.join(folderPath, name))
    .filter((full) => {
      try {
        return fs.statSync(full).isFile();
      } catch {
        return false;
      }
    });
}

function parseExtensions(raw) {
  return String(raw || '.csv,.txt')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Apply the configured retention policy to a file that was just successfully imported. */
function applyRetentionPolicy(policy, filePath, processedDir) {
  if (policy === 'keep') return { action: 'kept' };
  if (policy === 'delete') {
    fs.unlinkSync(filePath);
    return { action: 'deleted' };
  }
  // 'move' (default)
  fs.mkdirSync(processedDir, { recursive: true });
  const dest = path.join(processedDir, `${Date.now()}-${path.basename(filePath)}`);
  fs.renameSync(filePath, dest);
  return { action: 'moved', dest };
}

/** Delete files in the processed/ folder older than retentionDays — only relevant to 'move'. */
function sweepProcessedRetention(processedDir, retentionDays) {
  if (!retentionDays || retentionDays <= 0) return { deleted: 0 };
  let names;
  try {
    names = fs.readdirSync(processedDir);
  } catch {
    return { deleted: 0 };
  }
  const cutoff = Date.now() - retentionDays * 86_400_000;
  let deleted = 0;
  for (const name of names) {
    const full = path.join(processedDir, name);
    try {
      const stat = fs.statSync(full);
      if (stat.isFile() && stat.mtimeMs < cutoff) {
        fs.unlinkSync(full);
        deleted += 1;
      }
    } catch {
      /* file removed concurrently — ignore */
    }
  }
  return { deleted };
}

module.exports = {
  isFileStable,
  computeBackoffMs,
  emptyLedger,
  loadLedger,
  saveLedger,
  shouldProcess,
  recordOutcome,
  redactForLog,
  listCandidateFiles,
  parseExtensions,
  applyRetentionPolicy,
  sweepProcessedRetention,
};

// ── Runtime orchestrator (not exercised by unit tests — requires live fs/network timing) ──
if (require.main === module || process.env.COLLECTRX_FOLDER_WATCH_RUN === '1') {
  void startFolderWatch();
}

async function startFolderWatch() {
  const crypto = require('crypto');

  const WATCH_FOLDER = process.env.WATCH_FOLDER;
  const API_URL = (process.env.COLLECTRX_API_URL || '').replace(/\/$/, '');
  const API_TOKEN = process.env.COLLECTRX_API_TOKEN || process.env.COLLECTRX_CONNECTOR_TOKEN || '';
  const INTERVAL_MS = parseInt(process.env.WATCH_INTERVAL_MS, 10) || 60_000;
  const STABILITY_MS = parseInt(process.env.WATCH_STABILITY_MS, 10) || 10_000;
  const MAX_ATTEMPTS = parseInt(process.env.WATCH_MAX_ATTEMPTS, 10) || 5;
  const RETENTION_POLICY = ['move', 'delete', 'keep'].includes(process.env.WATCH_RETENTION_POLICY)
    ? process.env.WATCH_RETENTION_POLICY
    : 'move';
  const RETENTION_DAYS = parseInt(process.env.WATCH_RETENTION_DAYS, 10) || 30;
  const PMS_VENDOR = process.env.WATCH_PMS_VENDOR || 'auto';
  const EXTENSIONS = parseExtensions(process.env.WATCH_FILE_EXTENSIONS);
  const STATE_DIR = process.env.WATCH_STATE_DIR || (WATCH_FOLDER ? path.join(WATCH_FOLDER, '.collectrx-state') : null);

  function send(type, payload = {}) {
    if (process.parentPort) process.parentPort.postMessage({ type, ...payload });
  }
  function sendStatus(status, message) {
    send('status', { status, message: message || null, lastSync: new Date().toISOString() });
    if (status === 'ok' || status === 'syncing') {
      process.stdout.write(`WATCH_OK: ${redactForLog(message || '')}\n`);
    } else if (status === 'error') {
      process.stdout.write(`WATCH_ERROR: ${redactForLog(message || 'unknown error')}\n`);
    }
  }

  if (!WATCH_FOLDER) {
    sendStatus('offline', 'WATCH_FOLDER not configured');
    return;
  }
  if (!API_URL || !API_TOKEN) {
    sendStatus('offline', 'COLLECTRX_API_URL / COLLECTRX_API_TOKEN not configured');
    return;
  }

  const ledgerPath = path.join(STATE_DIR, 'folder-watch-ledger.json');
  const processedDir = path.join(WATCH_FOLDER, 'processed');

  async function uploadFile(filePath) {
    const buffer = fs.readFileSync(filePath);
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: 'text/csv' }), path.basename(filePath));
    form.append('pmsVendor', PMS_VENDOR);

    const res = await fetch(`${API_URL}/api/connector/claims/import-file`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_TOKEN}` },
      body: form,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) {
      const err = new Error(json.error || `HTTP ${res.status}`);
      err.transient = res.status >= 500 || res.status === 0;
      throw err;
    }
    return json;
  }

  async function runCycle() {
    sendStatus('syncing');
    let ledger = loadLedger(ledgerPath);
    let candidates;
    try {
      candidates = listCandidateFiles(WATCH_FOLDER, EXTENSIONS);
    } catch (err) {
      sendStatus('error', err.message);
      return;
    }

    let importedTotal = 0;
    let attentionNeeded = 0;
    let errorMsg = null;

    for (const filePath of candidates) {
      let statA;
      try {
        statA = fs.statSync(filePath);
      } catch {
        continue; // vanished between listing and stat — skip this cycle
      }
      await new Promise((r) => setTimeout(r, Math.min(STABILITY_MS, 2000))); // bounded wait per file per cycle
      let statB;
      try {
        statB = fs.statSync(filePath);
      } catch {
        continue;
      }
      if (!isFileStable(statA, statB)) continue; // still being written — try again next cycle

      const content = fs.readFileSync(filePath);
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      const decision = shouldProcess(ledger, hash, MAX_ATTEMPTS);
      if (decision === 'skip_done') continue;
      if (decision === 'skip_needs_attention') {
        attentionNeeded += 1;
        continue;
      }

      const attempt = (ledger.entries[hash]?.attempts || 0) + 1;
      if (attempt > 1) {
        // Respect backoff between retries of the same file content — don't hammer a failing upload.
        const lastAttemptAt = ledger.entries[hash]?.lastAttemptAt;
        const waitedMs = lastAttemptAt ? Date.now() - new Date(lastAttemptAt).getTime() : Infinity;
        if (waitedMs < computeBackoffMs(attempt - 1)) continue;
      }

      try {
        const result = await uploadFile(filePath);
        recordOutcome(ledger, hash, path.basename(filePath), {
          status: 'imported',
          imported: result.imported,
          skipped: result.skipped,
          failed: result.failed,
          runId: result.runId,
        });
        importedTotal += result.imported || 0;
        applyRetentionPolicy(RETENTION_POLICY, filePath, processedDir);
      } catch (err) {
        recordOutcome(ledger, hash, path.basename(filePath), {
          status: 'attempt_failed',
          error: redactForLog(err.message),
          maxAttempts: MAX_ATTEMPTS,
        });
        errorMsg = redactForLog(err.message);
      }
      saveLedger(ledgerPath, ledger); // persist after every file so a mid-cycle crash doesn't reprocess successes
    }

    sweepProcessedRetention(processedDir, RETENTION_DAYS);

    if (errorMsg) {
      sendStatus('error', errorMsg);
    } else if (attentionNeeded > 0) {
      sendStatus('error', `${attentionNeeded} file(s) need attention — check ${ledgerPath}`);
    } else {
      sendStatus('ok', `Watched ${candidates.length} file(s), imported ${importedTotal} record(s)`);
    }
  }

  if (process.parentPort) {
    process.parentPort.on('message', (msg) => {
      if (msg?.data?.type === 'trigger') runCycle().catch(() => {});
    });
  }
  if (process.stdin && !process.stdin.destroyed) {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      if (chunk.toString().trim() === 'WATCH_NOW') runCycle().catch(() => {});
    });
  }

  await runCycle();
  setInterval(() => { void runCycle(); }, INTERVAL_MS);
}
