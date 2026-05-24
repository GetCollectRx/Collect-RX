/**
 * Orchestrate startup scan + alert email after API is listening.
 */
import type { PrismaClient } from '@prisma/client';
import {
  runHttpStartupSmoke,
  runInternalStartupChecks,
  startupScanEnabled,
} from './startupHealthScan.js';
import { sendStartupFailureDigest } from './startupAlerts.js';

export async function runStartupScanOnBoot(prisma: PrismaClient, port: number): Promise<void> {
  if (!startupScanEnabled()) {
    return;
  }

  const host =
    process.env.PUBLIC_APP_URL ||
    process.env.SERVER_URL ||
    `http://127.0.0.1:${port}`;

  console.log('[startupScan] Running health scan…');

  const internal = await runInternalStartupChecks(prisma);
  const failedInternal = internal.filter((r) => !r.ok);
  if (failedInternal.length) {
    failedInternal.forEach((r) => console.warn(`[startupScan] ✗ ${r.label}: ${r.detail ?? ''}`));
  } else {
    console.log('[startupScan] Internal checks passed');
  }

  // Brief delay so listen socket is accepting connections
  await new Promise((r) => setTimeout(r, 1500));

  const localOrigin = `http://127.0.0.1:${port}`;
  const http = await runHttpStartupSmoke(localOrigin);
  const all = [...internal, ...http];
  const failed = all.filter((r) => !r.ok);
  if (failed.length === 0) {
    console.log('[startupScan] HTTP smoke passed');
  } else {
    failed.forEach((r) => console.warn(`[startupScan] ✗ ${r.label}: ${r.detail ?? ''}`));
  }

  await sendStartupFailureDigest(all, { host, source: 'api-server-boot' });
}
