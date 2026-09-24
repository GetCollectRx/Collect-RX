import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
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
} from '../../desktop/services/folderWatchSync.cjs';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crx-folder-watch-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('isFileStable', () => {
  it('is stable when size and mtime are unchanged and non-empty', () => {
    const stat = { size: 100, mtimeMs: 1000 };
    expect(isFileStable(stat, { ...stat })).toBe(true);
  });

  it('is not stable when size changed (still being written)', () => {
    expect(isFileStable({ size: 100, mtimeMs: 1000 }, { size: 150, mtimeMs: 1000 })).toBe(false);
  });

  it('is not stable when mtime changed', () => {
    expect(isFileStable({ size: 100, mtimeMs: 1000 }, { size: 100, mtimeMs: 2000 })).toBe(false);
  });

  it('rejects empty files (export not started / zero-byte placeholder)', () => {
    expect(isFileStable({ size: 0, mtimeMs: 1000 }, { size: 0, mtimeMs: 1000 })).toBe(false);
  });

  it('rejects missing stats', () => {
    expect(isFileStable(null, { size: 1, mtimeMs: 1 })).toBe(false);
    expect(isFileStable({ size: 1, mtimeMs: 1 }, undefined)).toBe(false);
  });
});

describe('computeBackoffMs', () => {
  it('grows exponentially and stays within a jitter band above the doubled base', () => {
    const b1 = computeBackoffMs(1, 1000, 60_000);
    const b2 = computeBackoffMs(2, 1000, 60_000);
    const b3 = computeBackoffMs(3, 1000, 60_000);
    expect(b1).toBeGreaterThanOrEqual(1000);
    expect(b1).toBeLessThan(1200);
    expect(b2).toBeGreaterThanOrEqual(2000);
    expect(b2).toBeLessThan(2400);
    expect(b3).toBeGreaterThanOrEqual(4000);
    expect(b3).toBeLessThan(4800);
  });

  it('caps at capMs regardless of attempt count', () => {
    const b = computeBackoffMs(20, 1000, 60_000);
    expect(b).toBeLessThanOrEqual(72_000); // cap + max 20% jitter
    expect(b).toBeGreaterThanOrEqual(60_000);
  });
});

describe('ledger load/save', () => {
  it('returns an empty ledger when the file does not exist', () => {
    const ledger = loadLedger(path.join(tmpDir, 'nope.json'));
    expect(ledger).toEqual(emptyLedger());
  });

  it('round-trips a saved ledger', () => {
    const ledgerPath = path.join(tmpDir, 'state', 'ledger.json');
    const ledger = emptyLedger();
    ledger.entries['abc123'] = { fileName: 'x.csv', status: 'done', attempts: 0 };
    saveLedger(ledgerPath, ledger);
    const reloaded = loadLedger(ledgerPath);
    expect(reloaded.entries['abc123'].fileName).toBe('x.csv');
  });

  it('recovers from a corrupt ledger file instead of throwing', () => {
    const ledgerPath = path.join(tmpDir, 'corrupt.json');
    fs.writeFileSync(ledgerPath, '{not valid json');
    expect(loadLedger(ledgerPath)).toEqual(emptyLedger());
  });
});

describe('shouldProcess', () => {
  it('processes an unseen hash', () => {
    expect(shouldProcess(emptyLedger(), 'newhash', 5)).toBe('process');
  });

  it('skips a hash already marked done', () => {
    const ledger = emptyLedger();
    ledger.entries.h = { status: 'done', attempts: 1 };
    expect(shouldProcess(ledger, 'h', 5)).toBe('skip_done');
  });

  it('retries a hash with failed attempts under the cap', () => {
    const ledger = emptyLedger();
    ledger.entries.h = { status: 'pending_retry', attempts: 2 };
    expect(shouldProcess(ledger, 'h', 5)).toBe('process');
  });

  it('stops retrying once attempts reach the cap', () => {
    const ledger = emptyLedger();
    ledger.entries.h = { status: 'pending_retry', attempts: 5 };
    expect(shouldProcess(ledger, 'h', 5)).toBe('skip_needs_attention');
  });

  it('never re-attempts a hash explicitly marked needs_attention, even if attempts is low', () => {
    const ledger = emptyLedger();
    ledger.entries.h = { status: 'needs_attention', attempts: 1 };
    expect(shouldProcess(ledger, 'h', 5)).toBe('skip_needs_attention');
  });
});

describe('recordOutcome', () => {
  it('marks a hash done on success, regardless of prior attempts', () => {
    const ledger = emptyLedger();
    ledger.entries.h = { attempts: 3 };
    recordOutcome(ledger, 'h', 'export.csv', { status: 'imported', imported: 10, skipped: 0, failed: 0, runId: 'r1' });
    expect(ledger.entries.h.status).toBe('done');
    expect(ledger.entries.h.lastResult).toEqual({ imported: 10, skipped: 0, failed: 0, runId: 'r1' });
  });

  it('increments attempts and stays pending_retry under the cap on failure', () => {
    const ledger = emptyLedger();
    recordOutcome(ledger, 'h', 'export.csv', { status: 'attempt_failed', error: 'network down', maxAttempts: 5 });
    expect(ledger.entries.h.attempts).toBe(1);
    expect(ledger.entries.h.status).toBe('pending_retry');
    expect(ledger.entries.h.lastError).toBe('network down');
  });

  it('flips to needs_attention once attempts reach maxAttempts', () => {
    const ledger = emptyLedger();
    ledger.entries.h = { attempts: 4, status: 'pending_retry' };
    recordOutcome(ledger, 'h', 'export.csv', { status: 'attempt_failed', error: 'still bad', maxAttempts: 5 });
    expect(ledger.entries.h.attempts).toBe(5);
    expect(ledger.entries.h.status).toBe('needs_attention');
  });
});

describe('redactForLog', () => {
  it('redacts email-shaped strings', () => {
    expect(redactForLog('contact jane.doe@example.com about it')).toBe('contact [redacted-email] about it');
  });

  it('redacts ISO date-shaped strings (could be a DOB)', () => {
    expect(redactForLog('DOB 1985-06-12 on file')).toBe('DOB [redacted-date] on file');
  });

  it('redacts phone-shaped strings', () => {
    expect(redactForLog('call 416-555-0100 now')).toBe('call [redacted-phone] now');
  });

  it('truncates long strings to avoid dumping full row contents into logs', () => {
    const long = 'x'.repeat(1000);
    expect(redactForLog(long).length).toBe(500);
  });

  it('passes through non-string values unchanged', () => {
    expect(redactForLog(undefined as unknown as string)).toBeUndefined();
  });
});

describe('parseExtensions', () => {
  it('defaults to .csv and .txt', () => {
    expect(parseExtensions(undefined)).toEqual(['.csv', '.txt']);
  });

  it('parses a custom comma-separated list, lowercased and trimmed', () => {
    expect(parseExtensions(' .CSV , .XLSX ')).toEqual(['.csv', '.xlsx']);
  });
});

describe('listCandidateFiles', () => {
  it('lists only files matching allowed extensions', () => {
    fs.writeFileSync(path.join(tmpDir, 'export.csv'), 'a');
    fs.writeFileSync(path.join(tmpDir, 'notes.txt'), 'b');
    fs.writeFileSync(path.join(tmpDir, 'image.png'), 'c');
    fs.mkdirSync(path.join(tmpDir, 'subdir'));
    const files = listCandidateFiles(tmpDir, ['.csv', '.txt']);
    expect(files.map((f) => path.basename(f)).sort()).toEqual(['export.csv', 'notes.txt']);
  });

  it('throws a clear error when the folder does not exist', () => {
    expect(() => listCandidateFiles(path.join(tmpDir, 'missing'), ['.csv'])).toThrow(/Cannot read watch folder/);
  });
});

describe('applyRetentionPolicy', () => {
  it('deletes the file under the delete policy', () => {
    const filePath = path.join(tmpDir, 'a.csv');
    fs.writeFileSync(filePath, 'data');
    applyRetentionPolicy('delete', filePath, path.join(tmpDir, 'processed'));
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('keeps the file in place under the keep policy', () => {
    const filePath = path.join(tmpDir, 'a.csv');
    fs.writeFileSync(filePath, 'data');
    applyRetentionPolicy('keep', filePath, path.join(tmpDir, 'processed'));
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('moves the file into the processed/ subfolder under the move policy (default)', () => {
    const filePath = path.join(tmpDir, 'a.csv');
    fs.writeFileSync(filePath, 'data');
    const processedDir = path.join(tmpDir, 'processed');
    const result = applyRetentionPolicy('move', filePath, processedDir);
    expect(fs.existsSync(filePath)).toBe(false);
    expect(fs.existsSync(result.dest)).toBe(true);
    expect(fs.readFileSync(result.dest, 'utf8')).toBe('data');
  });
});

describe('sweepProcessedRetention', () => {
  it('deletes files older than retentionDays and keeps newer ones', () => {
    const processedDir = path.join(tmpDir, 'processed');
    fs.mkdirSync(processedDir);
    const oldFile = path.join(processedDir, 'old.csv');
    const newFile = path.join(processedDir, 'new.csv');
    fs.writeFileSync(oldFile, 'x');
    fs.writeFileSync(newFile, 'y');
    const oldTime = (Date.now() - 40 * 86_400_000) / 1000;
    fs.utimesSync(oldFile, oldTime, oldTime);

    const result = sweepProcessedRetention(processedDir, 30);
    expect(result.deleted).toBe(1);
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(newFile)).toBe(true);
  });

  it('is a no-op when retentionDays is 0 or unset', () => {
    const processedDir = path.join(tmpDir, 'processed');
    fs.mkdirSync(processedDir);
    fs.writeFileSync(path.join(processedDir, 'a.csv'), 'x');
    expect(sweepProcessedRetention(processedDir, 0)).toEqual({ deleted: 0 });
  });

  it('returns zero deleted when the processed folder does not exist yet', () => {
    expect(sweepProcessedRetention(path.join(tmpDir, 'missing'), 30)).toEqual({ deleted: 0 });
  });
});
