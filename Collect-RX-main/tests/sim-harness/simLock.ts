/**
 * Cross-file mutual exclusion for sim suites that share one database.
 *
 * Both Stage 1 and the office-day suite run the queue tick, which works every
 * practice in the database. Run in parallel they dial each other's claims, so
 * results depend on timing. A lock file created with the exclusive flag makes
 * them take turns. A lock whose owner process is gone is reclaimed.
 */
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LOCK_PATH = path.join(os.tmpdir(), 'crx-sim-harness.lock');

function ownerAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function acquireSimLock(timeoutMs = 600_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const fd = openSync(LOCK_PATH, 'wx');
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return;
    } catch {
      let owner = 0;
      try {
        owner = Number(readFileSync(LOCK_PATH, 'utf8'));
      } catch {
        // The lock vanished between the failed create and the read; retry.
      }
      if (owner > 0 && !ownerAlive(owner)) {
        try {
          unlinkSync(LOCK_PATH);
        } catch {
          // Another waiter reclaimed it first.
        }
        continue;
      }
      if (Date.now() > deadline) throw new Error('[sim-harness] timed out waiting for the sim lock');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

export function releaseSimLock(): void {
  try {
    if (Number(readFileSync(LOCK_PATH, 'utf8')) === process.pid) unlinkSync(LOCK_PATH);
  } catch {
    // Already released.
  }
}
